/**
 * Settings and Beancount files in the bucket: the sync of each file, `runSync` over all selected
 * items, and settling conflicts and confirmed deletions. The CRDT stores are in s3CrdtSync.ts.
 */
import { CASHIER_DATA_DIR } from '#lib/constants';
import { exportSettingsJson, importSettingsJson } from '#lib/services/backupService';
import { normalizeEol } from '#lib/sync/SyncSource';
import { collectExportableFiles } from '#lib/utils/opfsExport';
import { deleteFile, saveBinaryFile } from '#lib/utils/opfslib';
import { deleteObject, getObject, putObject } from './s3Client';
import { decrypt, encrypt, sha256Hex } from './s3Crypto';
import { syncCrdt } from './s3CrdtSync';
import {
	canonical,
	dataKey,
	errorText,
	FILES_PREFIX,
	persist,
	recordLastSync,
	SETTINGS_PATH,
	TEXT,
	type S3Session,
	type SyncItem,
	type SyncLine,
	type SyncOutcome
} from './s3Session';
import {
	decide,
	isSafePath,
	latestRemote,
	nextEntry,
	TOMBSTONE,
	type SyncDirection
} from './s3SyncPlan';
// --- shared files (settings, Beancount files) ---

export interface SharedFile {
	item: SyncItem;
	path: string;
	read(): Promise<Uint8Array<ArrayBuffer> | null>;
	/** Returns the bytes actually stored, which may be a canonicalized form of `bytes`. */
	write(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array>;
	/** Deletes the local file. Absent for files that are never deleted (settings). */
	remove?(): Promise<void>;
}

export type LocalFiles = Map<string, FileSystemFileHandle>;

export async function listLocalFiles(): Promise<LocalFiles> {
	const map: LocalFiles = new Map();
	for (const e of await collectExportableFiles()) {
		if (e.path.startsWith(CASHIER_DATA_DIR)) continue;
		map.set(e.path, e.handle);
	}
	return map;
}

export const settingsFile = (): SharedFile => ({
	item: 'settings',
	path: SETTINGS_PATH,
	read: async () => TEXT.encode(await exportSettingsJson()),
	write: async (bytes) => {
		await importSettingsJson(new TextDecoder().decode(bytes));
		return bytes;
	}
});

export function beancountFile(path: string, local: LocalFiles): SharedFile {
	const opfsPath = path.slice(FILES_PREFIX.length);
	return {
		item: 'beancount',
		path,
		read: async () => {
			const handle = local.get(opfsPath);
			return handle ? new Uint8Array(await (await handle.getFile()).arrayBuffer()) : null;
		},
		write: (bytes) => saveBinaryFile(opfsPath, bytes),
		remove: async () => {
			if (!(await deleteFile(opfsPath))) throw new Error('Could not delete the local file');
		}
	};
}

/** Removes the file from the bucket and records a tombstone, so other devices learn of it. */
async function deleteShared(s: S3Session, file: SharedFile): Promise<void> {
	await deleteObject(s.cfg, dataKey(file.path));
	s.own.files[file.path] = nextEntry(s.manifests, file.path, TOMBSTONE);
	delete s.bases[file.path];
	s.manifestDirty = s.basesDirty = true;
}

/** Deletes the local file and forgets its last-synced hash. */
async function removeLocal(s: S3Session, file: SharedFile): Promise<void> {
	if (!file.remove) throw new Error('This file is never deleted');
	await file.remove();
	delete s.bases[file.path];
	s.basesDirty = true;
}

async function putShared(s: S3Session, file: SharedFile, bytes: Uint8Array<ArrayBuffer>) {
	await putObject(s.cfg, dataKey(file.path), await encrypt(s.key, bytes));
	const hash = await sha256Hex(bytes);
	s.own.files[file.path] = nextEntry(s.manifests, file.path, hash);
	s.bases[file.path] = hash;
	s.manifestDirty = s.basesDirty = true;
}

/**
 * Makes the manifest say what the bucket holds. The manifest only indexes the objects, so when
 * the two disagree the object is right. Changes no file and no object.
 */
export function repairManifest(s: S3Session, path: string, objectHash: string): void {
	if (latestRemote(s.manifests).get(path)?.hash === objectHash) return;
	s.own.files[path] = nextEntry(s.manifests, path, objectHash);
	s.manifestDirty = true;
}

async function getShared(s: S3Session, file: SharedFile): Promise<void> {
	const raw = await getObject(s.cfg, dataKey(file.path));
	if (!raw) throw new Error('Listed in a manifest but missing from the bucket');
	const bytes = await decrypt(s.key, raw);
	const written = await file.write(bytes);
	// The base is what is now on disk, which may differ from the object in line endings.
	const hash = await sha256Hex(written as Uint8Array<ArrayBuffer>);
	s.bases[file.path] = hash;
	s.basesDirty = true;
	// What was just written is the object, whatever the manifest says. Without this, a stale entry
	// would show the file as changed, and downloading it again would not clear that.
	const objectHash = await sha256Hex(bytes);
	repairManifest(s, file.path, objectHash);
	if (objectHash !== hash) {
		// The object holds the same text with other line endings: treat it as the base.
		s.equiv[file.path] = { base: hash, hashes: [objectHash] };
		s.equivDirty = true;
	}
}

/**
 * True when two copies of a text file are equal apart from line endings and the final newline,
 * which differ between Windows, Android and editors.
 */
function sameTextBytes(a: Uint8Array, b: Uint8Array): boolean {
	const text = (x: Uint8Array) => normalizeEol(new TextDecoder().decode(x));
	return text(a) === text(b);
}

async function syncShared(
	s: S3Session,
	direction: SyncDirection,
	file: SharedFile
): Promise<SyncLine> {
	const { item, path } = file;
	try {
		const bytes = await file.read();
		const rawLocal = bytes ? await sha256Hex(bytes) : null;
		const entry = latestRemote(s.manifests).get(path);
		const local = canonical(s, path, rawLocal);
		const remote = canonical(s, path, entry?.hash ?? null);
		let d = decide(direction, local, remote, s.bases[path] ?? null);

		// About to overwrite the bucket, or to call a conflict: check the object itself, not what
		// the manifest says about it. The manifest is only an index and may be out of date.
		if ((d.action === 'upload' || d.action === 'conflict') && entry && entry.hash !== TOMBSTONE) {
			const raw = await getObject(s.cfg, dataKey(path));
			const object = raw ? await decrypt(s.key, raw) : null;
			if (object) {
				const objectHash = await sha256Hex(object);
				if (objectHash !== entry.hash) {
					if (objectHash !== rawLocal) {
						// The bucket holds something this device has not seen: never overwrite it.
						return {
							item,
							path,
							outcome: 'conflict',
							message: 'The bucket copy differs from its manifest and from this device. Compare it.'
						};
					}
					// The bucket already holds this device's bytes: only the manifest is wrong.
					repairManifest(s, path, objectHash);
					s.bases[path] = objectHash;
					s.basesDirty = true;
					return { item, path, outcome: 'unchanged' };
				}
				if (
					d.action === 'conflict' &&
					item === 'beancount' &&
					bytes &&
					sameTextBytes(object, bytes)
				) {
					// Only line endings differ: not a real conflict. Make both sides hold the same bytes.
					d = { action: direction };
				}
			}
		}

		switch (d.action) {
			case 'upload':
				await putShared(s, file, bytes!);
				return { item, path, outcome: 'uploaded' };
			case 'download':
				await getShared(s, file);
				return { item, path, outcome: 'downloaded' };
			case 'delete-remote':
				return { item, path, outcome: 'pending-delete', message: d.reason, deletes: 'bucket' };
			case 'delete-local':
				return { item, path, outcome: 'pending-delete', message: d.reason, deletes: 'device' };
			case 'unchanged':
				// Equal on both sides: remember it, so a later change on one side is not a conflict.
				if (local && s.bases[path] !== local) {
					s.bases[path] = local;
					s.basesDirty = true;
				}
				// Gone on both sides: nothing left to compare against.
				if (!local && s.bases[path]) {
					delete s.bases[path];
					s.basesDirty = true;
				}
				return { item, path, outcome: 'unchanged' };
			case 'skip':
				return { item, path, outcome: 'skipped', message: d.reason };
			case 'conflict':
				return { item, path, outcome: 'conflict', message: d.reason };
		}
	} catch (e) {
		return { item, path, outcome: 'error', message: e instanceof Error ? e.message : String(e) };
	}
}

// --- entry points ---

/**
 * Uploads or downloads the selected items. Files that changed on both sides are left alone and
 * returned as `conflict` lines; resolve them with `resolveConflict`.
 */
export async function runSync(
	s: S3Session,
	direction: SyncDirection,
	items: SyncItem[],
	/** Called with each line as soon as it is known, so callers can show progress live. */
	onLine?: (line: SyncLine) => void
): Promise<SyncLine[]> {
	const lines: SyncLine[] = [];
	const add = (...added: SyncLine[]) => {
		for (const l of added) {
			lines.push(l);
			onLine?.(l);
		}
	};

	for (const item of items) {
		if (item === 'xacts' || item === 'scheduled') {
			add(...(await syncCrdt(s, direction, item)));
		}
	}

	if (items.includes('settings')) {
		add(await syncShared(s, direction, settingsFile()));
	}

	if (items.includes('beancount')) {
		const local = await listLocalFiles();
		const paths = new Set([...local.keys()].map((p) => FILES_PREFIX + p));
		for (const p of latestRemote(s.manifests).keys()) {
			if (p.startsWith(FILES_PREFIX)) paths.add(p);
		}
		for (const path of [...paths].sort()) {
			if (!isSafePath(path.slice(FILES_PREFIX.length))) {
				add({
					item: 'beancount',
					path,
					outcome: 'error',
					message: 'Unsafe file path, ignored'
				});
				continue;
			}
			add(await syncShared(s, direction, beancountFile(path, local)));
		}
	}

	await persist(s);
	if (!lines.some((l) => l.outcome === 'error')) await recordLastSync();
	return lines;
}

/** Settles a conflict: `local` overwrites the bucket's version, `remote` overwrites this device's. */
export async function resolveConflict(
	s: S3Session,
	line: SyncLine,
	keep: 'local' | 'remote'
): Promise<SyncLine> {
	const file = await sharedFileFor(line);
	const { item, path } = line;
	try {
		const bytes = await file.read();
		const remoteDeleted = latestRemote(s.manifests).get(path)?.hash === TOMBSTONE;
		let outcome: SyncOutcome;

		if (keep === 'local') {
			// A file deleted here is deleted in the bucket too; otherwise this version wins.
			if (bytes) {
				await putShared(s, file, bytes);
				outcome = 'uploaded';
			} else {
				await deleteShared(s, file);
				outcome = 'deleted';
			}
		} else if (remoteDeleted) {
			await removeLocal(s, file);
			outcome = 'deleted';
		} else {
			await getShared(s, file);
			outcome = 'downloaded';
		}
		await persist(s);
		return { item, path, outcome };
	} catch (e) {
		return { item, path, outcome: 'error', message: errorText(e) };
	}
}

/**
 * Writes a partial or full merge to this device only. Neither the bucket nor the last-synced
 * hash is touched, so the file keeps its status: still a conflict while it differs from the
 * bucket, and the remaining differences can be merged (or kept) later.
 */
export async function applyMerge(path: string, content: string): Promise<SyncLine> {
	const line: SyncLine = { item: 'beancount', path: FILES_PREFIX + path, outcome: 'merged' };
	try {
		if (!isSafePath(path)) throw new Error('Unsafe file path');
		await saveBinaryFile(path, TEXT.encode(content));
		return line;
	} catch (e) {
		return { ...line, outcome: 'error', message: errorText(e) };
	}
}

async function sharedFileFor(line: SyncLine): Promise<SharedFile> {
	return line.item === 'settings'
		? settingsFile()
		: beancountFile(line.path, await listLocalFiles());
}

/** Applies a `pending-delete` line the user has confirmed. */
export async function applyDeletion(s: S3Session, line: SyncLine): Promise<SyncLine> {
	const { item, path } = line;
	try {
		const file = await sharedFileFor(line);
		if (line.deletes === 'bucket') await deleteShared(s, file);
		else await removeLocal(s, file);
		await persist(s);
		return { item, path, outcome: 'deleted' };
	} catch (e) {
		return { item, path, outcome: 'error', message: errorText(e) };
	}
}
