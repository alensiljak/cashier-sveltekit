/**
 * Manual sync of the app's data with an S3 bucket. See doc/projects/2026-10-05_s3-sync.md.
 *
 * Bucket layout (every object except key.json is encrypted, see s3Crypto.ts):
 * - key.json                  key-derivation parameters, shared by all devices
 * - manifests/<deviceId>.json what each device last uploaded (path -> hash, time)
 * - data/settings.json        shared settings
 * - data/files/<path>         Beancount files, by their OPFS path
 * - crdt/<xacts|scx>/snap-<ulid>.ydoc, crdt/<xacts|scx>/<deviceId>.<seq>.upd
 *                             the CRDT stores as a snapshot plus per-device deltas (see
 *                             sync/deltaSync.ts). Merged on download, so they never conflict.
 *                             The older crdt/<kind>/<deviceId>.ydoc files are still read.
 *
 * Settings and files can be changed on several devices. They are compared by content hash
 * against the last-synced hash, and a change on both sides is reported as a conflict to be
 * resolved by the user, never overwritten silently.
 */
import * as Y from 'yjs';
import { CASHIER_DATA_DIR } from '#lib/constants';
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { exportSettingsJson, importSettingsJson } from '#lib/services/backupService';
import db from '#lib/data/db';
import { getDeviceId, type DocKind } from '#lib/sync/ydocDevices';
import {
	DeltaSync,
	decodeSnapshot,
	deltaKey,
	deviceDeltaPrefix,
	deviceOfKey,
	kindPrefix,
	needsCompaction,
	vectorOf
} from '#lib/sync/deltaSync';
import { deviceSettingsStateStorage } from '#lib/sync/deltaStateStorage';
import { normalizeEol } from '#lib/sync/SyncSource';
import { getXactStore } from '#lib/storage/xactStoreRegistry';
import { getScxStore } from '#lib/storage/scxStoreRegistry';
import { hasRetiredOps, readUpdateMeta, type RecordChange } from '#lib/storage/crdtDocStore';
import type { XactRecord } from '#lib/storage/crdtXactRecord';
import type { ScxRecord } from '#lib/storage/crdtScxRecord';
import { collectExportableFiles } from '#lib/utils/opfsExport';
import { deleteFile, saveBinaryFile } from '#lib/utils/opfslib';
import type { S3Config } from './s3Config';
import { deleteObject, getObject, listObjectInfos, listObjects, putObject } from './s3Client';
import { decryptCrdtObject, S3RemoteStore } from './s3RemoteStore';
import { createKeyParams, decrypt, encrypt, openKey, sha256Hex, type KeyParams } from './s3Crypto';
import {
	decide,
	isSafePath,
	latestRemote,
	nextEntry,
	TOMBSTONE,
	type Manifest,
	type SyncDirection
} from './s3SyncPlan';

export type SyncItem = 'settings' | 'scheduled' | 'xacts' | 'beancount';

export type SyncOutcome =
	| 'uploaded'
	| 'downloaded'
	| 'deleted'
	| 'merged'
	| 'pending-delete'
	| 'unchanged'
	| 'skipped'
	| 'conflict'
	| 'error';

export interface SyncLine {
	item: SyncItem;
	/** Logical path, e.g. `files/2024/main.bean`, or a CRDT object key. */
	path: string;
	outcome: SyncOutcome;
	message?: string;
	/** For `pending-delete`: where the file would be deleted. */
	deletes?: 'bucket' | 'device';
}

export interface S3Session {
	cfg: S3Config;
	key: CryptoKey;
	deviceId: string;
	/** All devices' manifests, including this device's own. */
	manifests: Manifest[];
	own: Manifest;
	/** path -> hash at the last sync. */
	bases: Record<string, string>;
	/** path -> hashes verified to hold the same text as `base`. Void once the base changes. */
	equiv: Record<string, Equivalent>;
	manifestDirty: boolean;
	basesDirty: boolean;
	equivDirty: boolean;
}

interface Equivalent {
	base: string;
	hashes: string[];
}

const TEXT = new TextEncoder();
const SETTINGS_PATH = 'settings.json';
const FILES_PREFIX = 'files/';

const dataKey = (path: string) => `data/${path}`;
const manifestKey = (deviceId: string) => `manifests/${deviceId}.json`;

// --- session ---

async function loadKey(cfg: S3Config): Promise<CryptoKey> {
	const read = async (): Promise<KeyParams | null> => {
		const raw = await getObject(cfg, 'key.json');
		return raw ? (JSON.parse(new TextDecoder().decode(raw)) as KeyParams) : null;
	};

	let params = await read();
	if (!params) {
		const created = await createKeyParams(cfg.passphrase);
		const won = await putObject(cfg, 'key.json', JSON.stringify(created.params), {
			contentType: 'application/json',
			onlyIfAbsent: true
		});
		if (won) return created.key;
		// Another device created it first; use theirs.
		params = await read();
		if (!params) throw new Error('Could not create the encryption key file in the bucket.');
	}
	return openKey(cfg.passphrase, params);
}

async function loadManifests(cfg: S3Config, key: CryptoKey): Promise<Manifest[]> {
	const manifests: Manifest[] = [];
	for (const objectKey of await listObjects(cfg, 'manifests/')) {
		try {
			const raw = await getObject(cfg, objectKey);
			if (!raw) continue;
			manifests.push(JSON.parse(new TextDecoder().decode(await decrypt(key, raw))) as Manifest);
		} catch (e) {
			console.warn('[s3-sync] Ignoring unreadable manifest', objectKey, e);
		}
	}
	return manifests;
}

/**
 * Connects to the bucket: creates the encryption key parameters on first use, or checks the
 * passphrase against them, then reads all manifests. Throws `WrongPassphraseError` on mismatch.
 */
export async function openSession(cfg: S3Config): Promise<S3Session> {
	if (!cfg.passphrase) {
		throw new Error('Set an encryption passphrase in the S3 configuration first.');
	}
	const key = await loadKey(cfg);
	const deviceId = await getDeviceId();
	const manifests = await loadManifests(cfg, key);
	let own = manifests.find((m) => m.deviceId === deviceId);
	if (!own) {
		own = { deviceId, updated: '', files: {} };
		manifests.push(own);
	}
	const bases =
		(await deviceSettings.get<Record<string, string>>(DeviceSettingKeys.s3SyncBase)) ?? {};
	const equiv =
		(await deviceSettings.get<Record<string, Equivalent>>(DeviceSettingKeys.s3SyncEquiv)) ?? {};
	return {
		cfg,
		key,
		deviceId,
		manifests,
		own,
		bases,
		equiv,
		manifestDirty: false,
		basesDirty: false,
		equivDirty: false
	};
}

/**
 * A hash verified to hold the same text as the last-synced version counts as that version, so
 * that a copy differing only in line endings is not taken for a change.
 */
function canonical(
	s: Pick<S3Session, 'bases' | 'equiv'>,
	path: string,
	hash: string | null
): string | null {
	const e = s.equiv[path];
	const base = s.bases[path];
	return hash !== null && e && base === e.base && e.hashes.includes(hash) ? base : hash;
}

/** Writes this device's manifest and the last-synced hashes, if they changed. */
async function persist(s: S3Session): Promise<void> {
	if (s.manifestDirty) {
		s.own.updated = new Date().toISOString();
		const body = await encrypt(s.key, TEXT.encode(JSON.stringify(s.own)));
		await putObject(s.cfg, manifestKey(s.deviceId), body);
		s.manifestDirty = false;
	}
	if (s.basesDirty) {
		await deviceSettings.set(DeviceSettingKeys.s3SyncBase, s.bases);
		s.basesDirty = false;
	}
	if (s.equivDirty) {
		await deviceSettings.set(DeviceSettingKeys.s3SyncEquiv, s.equiv);
		s.equivDirty = false;
	}
}

// --- shared files (settings, Beancount files) ---

interface SharedFile {
	item: SyncItem;
	path: string;
	read(): Promise<Uint8Array<ArrayBuffer> | null>;
	/** Returns the bytes actually stored, which may be a canonicalized form of `bytes`. */
	write(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array>;
	/** Deletes the local file. Absent for files that are never deleted (settings). */
	remove?(): Promise<void>;
}

type LocalFiles = Map<string, FileSystemFileHandle>;

async function listLocalFiles(): Promise<LocalFiles> {
	const map: LocalFiles = new Map();
	for (const e of await collectExportableFiles()) {
		if (e.path.startsWith(CASHIER_DATA_DIR)) continue;
		map.set(e.path, e.handle);
	}
	return map;
}

const settingsFile = (): SharedFile => ({
	item: 'settings',
	path: SETTINGS_PATH,
	read: async () => TEXT.encode(await exportSettingsJson()),
	write: async (bytes) => {
		await importSettingsJson(new TextDecoder().decode(bytes));
		return bytes;
	}
});

function beancountFile(path: string, local: LocalFiles): SharedFile {
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
function repairManifest(s: S3Session, path: string, objectHash: string): void {
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

// --- CRDT stores (transactions, scheduled transactions) ---

/**
 * The device that wrote a CRDT object (`crdt/<kind>/<deviceId>.<seq>.upd`, or the legacy
 * `crdt/<kind>/<deviceId>.ydoc`), or null for a snapshot and anything else.
 */
const deviceIdOfKey = (objectKey: string): string | null => {
	const kind = /^crdt\/([^/]+)\//.exec(objectKey)?.[1];
	return kind === 'xacts' || kind === 'scx' ? deviceOfKey(kind, objectKey) : null;
};

/** Why another device's CRDT state is not merged here: not on the Trusted Devices list, or read-only. */
async function loadIgnoreReasons(): Promise<(deviceId: string | null) => string | null> {
	const peers = new Map((await db.peers.toArray()).map((p) => [p.id, p]));
	return (deviceId) => {
		const peer = deviceId ? peers.get(deviceId) : undefined;
		if (!peer) return 'Device not trusted';
		return peer.readOnly ? 'Device is read-only' : null;
	};
}

const kindOf = (item: 'xacts' | 'scheduled'): DocKind => (item === 'xacts' ? 'xacts' : 'scx');

/** `own` is the open session's manifest, when there is one: acknowledgements are kept in line with it. */
type CrdtSession = Pick<S3Session, 'cfg' | 'key' | 'deviceId'> & { own?: Manifest };

/** A device counts for compaction when its manifest was written within this time. */
const ACTIVE_WINDOW_MS = 30 * 24 * 3600 * 1000;

const storeOf = (item: 'xacts' | 'scheduled') =>
	item === 'xacts' ? getXactStore() : getScxStore();

/** One delta sync per store and bucket, so the changes made meanwhile are captured for upload. */
const deltaSyncs = new Map<string, { store: object; sync: DeltaSync }>();

/**
 * The delta sync of a store for this bucket, attached to the store's changes. Created on first
 * use; later calls only refresh the transport (the key is derived again) and the trust list.
 */
async function deltaSyncFor(s: CrdtSession, item: 'xacts' | 'scheduled'): Promise<DeltaSync> {
	const kind = kindOf(item);
	const store = await storeOf(item);
	const bucketId = `${s.cfg.endpoint}|${s.cfg.bucket}|${s.cfg.prefix}`;
	const id = `${kind}|${bucketId}`;
	const remote = new S3RemoteStore(s.cfg, s.key);
	const ignore = await loadIgnoreReasons();

	let entry = deltaSyncs.get(id);
	if (entry && entry.store !== store) {
		entry.sync.dispose();
		entry = undefined;
	}
	if (!entry) {
		entry = {
			store,
			sync: new DeltaSync({
				kind,
				deviceId: s.deviceId,
				doc: store,
				remote,
				storage: deviceSettingsStateStorage(kind, bucketId),
				ignore
			})
		};
		deltaSyncs.set(id, entry);
	} else {
		entry.sync.configure({ remote, ignore });
	}
	await entry.sync.attach();
	return entry.sync;
}

/** This device's manifest as the bucket holds it, or an empty one. */
async function readOwnManifest(s: CrdtSession): Promise<Manifest> {
	const raw = await getObject(s.cfg, manifestKey(s.deviceId));
	if (!raw) return { deviceId: s.deviceId, updated: '', files: {} };
	return JSON.parse(new TextDecoder().decode(await decrypt(s.key, raw))) as Manifest;
}

/**
 * Tells the other devices, in this device's manifest, what it has applied of the store, so they
 * know which deltas they may delete. Writes only when that changed.
 */
async function publishAck(s: CrdtSession, kind: DocKind, sync: DeltaSync): Promise<void> {
	const ack = await sync.ack();
	if (!ack) return;
	const manifest = await readOwnManifest(s);
	manifest.crdt = { ...manifest.crdt, [kind]: ack };
	manifest.updated = new Date().toISOString();
	await putObject(
		s.cfg,
		manifestKey(s.deviceId),
		await encrypt(s.key, TEXT.encode(JSON.stringify(manifest)))
	);
	// An open session writes its manifest again later: it must not take the acknowledgement back.
	if (s.own) s.own.crdt = manifest.crdt;
	await sync.markAcked(ack);
}

/**
 * What each active device has applied of the store: trusted devices whose manifest was written
 * recently and carries an acknowledgement. Others (old app versions, long absent) do not hold
 * back clean-up; a device that lags takes the snapshot instead.
 */
async function activeAcks(
	s: CrdtSession,
	kind: DocKind
): Promise<Record<string, Record<string, number>>> {
	const [manifests, peers] = await Promise.all([loadManifests(s.cfg, s.key), db.peers.toArray()]);
	const trusted = new Set(peers.map((p) => p.id));
	const acks: Record<string, Record<string, number>> = {};
	for (const m of manifests) {
		const ack = m.crdt?.[kind];
		if (m.deviceId === s.deviceId || !trusted.has(m.deviceId) || !ack) continue;
		if (!(Date.now() - Date.parse(m.updated) <= ACTIVE_WINDOW_MS)) continue;
		acks[m.deviceId] = ack.applied;
	}
	return acks;
}

/** Compacts the store's objects when enough have piled up. Never fails the sync it follows. */
async function compactIfDue(s: CrdtSession, kind: DocKind, sync: DeltaSync): Promise<void> {
	if (!needsCompaction(await sync.objects())) return;
	const result = await sync.compact(await activeAcks(s, kind));
	if (result.skipped) console.warn('[s3-sync] Compaction skipped:', kind, result.skipped);
}

async function syncCrdt(
	s: CrdtSession,
	direction: SyncDirection,
	item: 'xacts' | 'scheduled'
): Promise<SyncLine[]> {
	const kind = kindOf(item);
	const prefix = kindPrefix(kind);
	const lines: SyncLine[] = [];

	try {
		if (direction === 'upload') {
			// A background action must not create the scheduled-transactions store: that would
			// pre-empt its first-launch migration prompt (see webdavAutoBackupService).
			if (item === 'scheduled' && !(await (await storeOf(item)).isInitialized())) {
				return [{ item, path: prefix, outcome: 'skipped', message: 'Not set up on this device' }];
			}
			const sync = await deltaSyncFor(s, item);
			const { seq } = await sync.upload();
			try {
				await publishAck(s, kind, sync);
				await compactIfDue(s, kind, sync);
			} catch (e) {
				console.warn('[s3-sync] Clean-up failed:', kind, e);
			}
			return [
				seq === null
					? { item, path: prefix, outcome: 'unchanged' }
					: { item, path: deltaKey(kind, s.deviceId, seq), outcome: 'uploaded' }
			];
		}

		const sync = await deltaSyncFor(s, item);
		const r = await sync.download();
		try {
			await publishAck(s, kind, sync);
		} catch (e) {
			console.warn('[s3-sync] Could not publish the acknowledgement:', kind, e);
		}
		if (!r.foreign) {
			return [
				{ item, path: prefix, outcome: 'skipped', message: 'No other device has uploaded yet' }
			];
		}
		for (const { deviceId, reason } of r.skipped) {
			lines.push({
				item,
				path: deviceDeltaPrefix(kind, deviceId),
				outcome: 'skipped',
				message: reason
			});
		}
		for (const g of r.gaps) {
			lines.push({
				item,
				path: deltaKey(kind, g.deviceId, g.expected),
				outcome: 'error',
				message: `Missing from the bucket (the next one found is ${g.found}); changes after it are not merged yet`
			});
		}
		for (const e of r.errors) {
			lines.push({ item, path: e.key, outcome: 'error', message: e.message });
		}
		// The bucket already holds what it returned: it is not uploaded again as our own.
		const applied = r.snapshot || r.deltas > 0 || r.legacy > 0;
		if (applied || !lines.length) {
			lines.push({
				item,
				path: prefix,
				outcome: r.changes ? 'downloaded' : 'unchanged',
				message: r.changes ? `${r.changes} changes merged` : undefined
			});
		}
	} catch (e) {
		lines.push({ item, path: prefix, outcome: 'error', message: errorText(e) });
	}
	return lines;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

/**
 * Uploads this device's CRDT state (transactions, scheduled transactions) for the automatic
 * backup. Needs only the key, not the manifests, and never conflicts: each device owns its file.
 * Resolves to the lines that failed (empty on success).
 */
export async function backupCrdtStores(
	cfg: S3Config,
	kinds: DocKind[] = ['xacts', 'scx']
): Promise<SyncLine[]> {
	const session = await crdtSession(cfg);
	const lines: SyncLine[] = [];
	if (kinds.includes('xacts')) lines.push(...(await syncCrdt(session, 'upload', 'xacts')));
	if (kinds.includes('scx')) lines.push(...(await syncCrdt(session, 'upload', 'scheduled')));
	return lines.filter((l) => l.outcome === 'error');
}

/**
 * True when the bucket and this device differ in a CRDT store: another device has changes not
 * merged here, or this device has changes the bucket lacks.
 */
async function crdtDiffers(s: CrdtSession, item: 'xacts' | 'scheduled'): Promise<boolean> {
	const { upload, download } = await crdtStatus(s, item);
	return upload || download;
}

/**
 * Compares a CRDT store with the bucket from one listing, without reading any object: `upload`
 * = this device has changes the bucket lacks; `download` = a trusted device (or a snapshot)
 * has changes not merged here.
 */
async function crdtStatus(
	s: CrdtSession,
	item: 'xacts' | 'scheduled'
): Promise<{ upload: boolean; download: boolean }> {
	if (item === 'scheduled' && !(await (await storeOf(item)).isInitialized())) {
		return { upload: false, download: false };
	}
	return (await deltaSyncFor(s, item)).status();
}

export interface CrdtSyncStatus {
	upload: boolean;
	download: boolean;
}

/** Dry run for the CRDT stores, per item. Lists the bucket, but reads no object. */
export async function fetchCrdtSyncStatus(
	cfg: S3Config
): Promise<Record<'scheduled' | 'xacts', CrdtSyncStatus>> {
	const s = await crdtSession(cfg);
	return {
		scheduled: await crdtStatus(s, 'scheduled'),
		xacts: await crdtStatus(s, 'xacts')
	};
}

export type CrdtRecord = XactRecord | ScxRecord;

export interface CrdtDownloadPreview {
	deviceId: string | null;
	/** Name from the Trusted Devices list. */
	name?: string;
	key: string;
	/** What merging this device's file would change here, on top of the devices listed before it. */
	changes: RecordChange<CrdtRecord>[];
	/** Why the file would not be merged: the device is not trusted, or is read-only. */
	ignored?: string;
}

export interface CrdtChangePreview {
	/** Records a download would add, change or delete on this device. */
	download: CrdtDownloadPreview[];
	/** Records an upload would add, change or delete for the other devices' merged view. */
	upload: RecordChange<CrdtRecord>[];
}

/**
 * Dry run of a CRDT store sync, down to the single records, so the user can see what a merge
 * would do before accepting either direction. Reads the bucket, writes nothing anywhere.
 * Needs the passphrase.
 */
export async function previewCrdtChanges(
	cfg: S3Config,
	item: 'xacts' | 'scheduled'
): Promise<CrdtChangePreview> {
	const s = await crdtSession(cfg);
	const store = await storeOf(item);
	if (item === 'scheduled' && !(await store.isInitialized())) return { download: [], upload: [] };

	const sync = await deltaSyncFor(s, item);
	const [ignoreReason, peers] = await Promise.all([loadIgnoreReasons(), db.peers.toArray()]);
	const files: CrdtDownloadPreview[] = [];

	// Devices whose data is not merged here: one line each.
	const ignoredSeen = new Set<string>();
	for (const o of await sync.objects()) {
		const reason = o.deviceId && o.deviceId !== s.deviceId ? ignoreReason(o.deviceId) : null;
		if (reason && !ignoredSeen.has(o.deviceId!)) {
			ignoredSeen.add(o.deviceId!);
			files.push({ deviceId: o.deviceId, key: o.key, changes: [], ignored: reason });
		}
	}

	// What a download would apply, one object after the other.
	const unapplied = await sync.read({ unappliedOnly: true });
	const results = await store.previewImport(unapplied.map((u) => u.update));
	unapplied.forEach(({ object }, i) =>
		files.push({
			deviceId: object.deviceId,
			name: peers.find((p) => p.id === object.deviceId)?.name,
			key: object.key,
			changes: results[i]
		})
	);

	// What an upload would change in the view the other devices build from the bucket.
	const bucket = await sync.read({ unappliedOnly: false });
	return {
		download: files,
		upload: await store.previewExportOnto(bucket.map((b) => b.update))
	};
}

export interface CrdtDiagnosticFile {
	key: string;
	own: boolean;
	name?: string;
	ignored?: string;
	/** Clients whose clock in this file is ahead of this device's: what makes the check say "download". */
	ahead: { client: number; theirs: number; ours: number }[];
	/** The file holds operations from before this device's last reset, which a merge skips. */
	retiredOps: boolean;
	/** The structs that make it `retiredOps`: this device's retired clock for the client is above theirs. */
	retiredHits: { client: number; clock: number; limit: number; kind: string }[];
	resetId: string;
	/** Clients with operations in this file, and how many of those structs a merge would apply. */
	structCount: number;
}

export interface CrdtDiagnostics {
	localResetId: string;
	localClients: number;
	files: CrdtDiagnosticFile[];
	/** Clients whose local clock is ahead of everything in the bucket: what makes the check say "upload". */
	uploadAhead: { client: number; ours: number; bucket: number }[];
}

/** Explains the "download" / "upload" verdict of the state-vector check, file by file. */
export async function diagnoseCrdt(
	cfg: S3Config,
	item: 'xacts' | 'scheduled'
): Promise<CrdtDiagnostics> {
	const s = await crdtSession(cfg);
	const store = await storeOf(item);
	const sync = await deltaSyncFor(s, item);
	const local = await store.exportState();
	const ours = vectorOf(local);
	const localMeta = readUpdateMeta(local);

	const [ignoreReason, peers] = await Promise.all([loadIgnoreReasons(), db.peers.toArray()]);
	const files: CrdtDiagnosticFile[] = [];
	const bucket = new Map<number, number>();
	for (const { object, update } of await sync.read({
		unappliedOnly: false,
		includeIgnored: true
	})) {
		const own = object.deviceId === s.deviceId;
		const ignored = !own && object.deviceId ? ignoreReason(object.deviceId) : null;
		const theirs = vectorOf(update);
		if (!ignored) {
			for (const [client, clock] of theirs) {
				bucket.set(client, Math.max(bucket.get(client) ?? 0, clock));
			}
		}
		files.push({
			key: object.key,
			own,
			name: peers.find((p) => p.id === object.deviceId)?.name,
			ignored: ignored ?? undefined,
			ahead: [...theirs]
				.filter(([client, clock]) => clock > (ours.get(client) ?? 0))
				.map(([client, clock]) => ({ client, theirs: clock, ours: ours.get(client) ?? 0 })),
			retiredOps: hasRetiredOps(update, localMeta.retired),
			retiredHits: Y.decodeUpdate(update)
				.structs.flatMap((st) => {
					const limit = localMeta.retired[st.id.client];
					return limit !== undefined && st.id.clock < limit
						? [{ client: st.id.client, clock: st.id.clock, limit, kind: st.constructor.name }]
						: [];
				})
				.slice(0, 20),
			resetId: readUpdateMeta(update).resetId,
			structCount: Y.decodeUpdate(update).structs.length
		});
	}

	return {
		localResetId: localMeta.resetId,
		localClients: ours.size,
		files,
		uploadAhead: [...ours]
			.filter(([client, clock]) => clock > (bucket.get(client) ?? 0))
			.map(([client, clock]) => ({ client, ours: clock, bucket: bucket.get(client) ?? 0 }))
	};
}

async function crdtSession(cfg: S3Config): Promise<CrdtSession> {
	return { cfg, key: await getSyncKey(cfg), deviceId: await getDeviceId() };
}

/** Compares the CRDT stores with the bucket without changing anything. True = they differ. */
export async function checkCrdtStores(cfg: S3Config): Promise<boolean> {
	const s = await crdtSession(cfg);
	return (await crdtDiffers(s, 'xacts')) || (await crdtDiffers(s, 'scheduled'));
}

/**
 * Full sync of the CRDT stores: merges the other devices' state, then uploads this device's.
 * Returns the failed lines and whether records were merged in (the ledger then needs a reload).
 */
export async function syncCrdtStores(
	cfg: S3Config
): Promise<{ errors: SyncLine[]; merged: boolean }> {
	const s = await crdtSession(cfg);
	const down = [
		...(await syncCrdt(s, 'download', 'xacts')),
		...(await syncCrdt(s, 'download', 'scheduled'))
	];
	const up = [
		...(await syncCrdt(s, 'upload', 'xacts')),
		...(await syncCrdt(s, 'upload', 'scheduled'))
	];
	const errors = [...down, ...up].filter((l) => l.outcome === 'error');
	if (!errors.length) await recordLastSync();
	return {
		errors,
		merged: down.some((l) => l.outcome === 'downloaded' && l.item === 'xacts')
	};
}

/**
 * Removes everything a device wrote to the bucket: its deltas, its legacy state files and its
 * manifest. Call it while the device is still trusted. What it wrote is merged here first and
 * published in a snapshot, so no other device loses a change that only its deltas held. Stops
 * with an error, deleting nothing for that store, when something could not be merged.
 */
export async function forgetBucketDevice(
	cfg: S3Config,
	deviceId: string
): Promise<{ deleted: number }> {
	const s = await crdtSession(cfg);
	let deleted = 0;
	for (const item of ['xacts', 'scheduled'] as const) {
		// A store this device never set up has nothing here to merge the other device's data into.
		if (item === 'scheduled' && !(await (await storeOf(item)).isInitialized())) continue;
		deleted += (await (await deltaSyncFor(s, item)).forget(deviceId)).deleted;
	}
	await deleteObject(cfg, manifestKey(deviceId));
	return { deleted };
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

// --- status ---

export interface RemoteItemStatus {
	/** Newest server-side modification among the item's objects. */
	lastModified: Date | null;
	/** Objects (files, or per-device state files) behind the item. */
	count: number;
	/** CRDT items: the newest upload by another device, if any. */
	otherDeviceModified?: Date | null;
}

export interface RemoteOverview {
	settings: RemoteItemStatus;
	scheduled: RemoteItemStatus;
	xacts: RemoteItemStatus;
	beancount: RemoteItemStatus;
}

const newest = (dates: (Date | null)[]): Date | null =>
	dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

/**
 * What the bucket holds and when it last changed, from a plain listing. Needs no passphrase and
 * decrypts nothing.
 */
export async function fetchRemoteOverview(cfg: S3Config): Promise<RemoteOverview> {
	const deviceId = await getDeviceId();
	const ignoreReason = await loadIgnoreReasons();
	const [data, xacts, scx] = await Promise.all([
		listObjectInfos(cfg, 'data/'),
		listObjectInfos(cfg, 'crdt/xacts/'),
		listObjectInfos(cfg, 'crdt/scx/')
	]);

	// Only devices whose data would be merged count as "other devices".
	const crdt = (infos: typeof xacts): RemoteItemStatus => ({
		lastModified: newest(infos.map((i) => i.lastModified)),
		count: infos.length,
		otherDeviceModified: newest(
			infos
				.filter((i) => {
					const writer = deviceIdOfKey(i.key);
					return writer !== null && writer !== deviceId && !ignoreReason(writer);
				})
				.map((i) => i.lastModified)
		)
	});
	const files = data.filter((i) => i.key.startsWith(dataKey(FILES_PREFIX)));
	const settings = data.filter((i) => i.key === dataKey(SETTINGS_PATH));

	return {
		settings: { lastModified: newest(settings.map((i) => i.lastModified)), count: settings.length },
		scheduled: crdt(scx),
		xacts: crdt(xacts),
		beancount: { lastModified: newest(files.map((i) => i.lastModified)), count: files.length }
	};
}

export interface BucketDevice {
	deviceId: string;
	lastModified: Date | null;
	/** Name from the Trusted Devices list, when trusted. */
	name?: string;
	trusted: boolean;
	readOnly: boolean;
}

/** Other devices that have uploaded CRDT state to the bucket, by a plain listing (no passphrase needed). */
export async function listBucketDevices(cfg: S3Config): Promise<BucketDevice[]> {
	const [selfId, peers, xacts, scx] = await Promise.all([
		getDeviceId(),
		db.peers.toArray(),
		listObjectInfos(cfg, 'crdt/xacts/'),
		listObjectInfos(cfg, 'crdt/scx/')
	]);
	const found = new Map<string, Date | null>();
	for (const i of [...xacts, ...scx]) {
		const id = deviceIdOfKey(i.key);
		if (!id || id === selfId) continue;
		found.set(id, newest([found.get(id) ?? null, i.lastModified]));
	}
	return [...found]
		.map(([deviceId, lastModified]) => {
			const peer = peers.find((p) => p.id === deviceId);
			return {
				deviceId,
				lastModified,
				name: peer?.name,
				trusted: !!peer,
				readOnly: !!peer?.readOnly
			};
		})
		.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

/** When this device last finished an upload or download, or null if it never has. */
export async function getLastSync(): Promise<Date | null> {
	const iso = await deviceSettings.get<string>(DeviceSettingKeys.s3LastSync);
	return iso ? new Date(iso) : null;
}

async function recordLastSync(): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.s3LastSync, new Date().toISOString());
}

/** Whether a file-based item differs between this device and the bucket, and which way. */
export interface FileSyncStatus {
	/** Files that exist or changed here and would be uploaded (or deleted from the bucket). */
	upload: number;
	/** Files that are newer in the bucket and would be downloaded (or deleted here). */
	download: number;
	conflict: number;
}

export type FileSyncOverview = Record<'settings' | 'beancount', FileSyncStatus>;

/** What an upload or download would do per path, in the same terms as `decide`. */
function classify(
	local: string | null,
	remote: string | null,
	base: string | null
): { kind: 'upload' | 'download' | 'conflict'; reason?: string } | null {
	const up = decide('upload', local, remote, base);
	const down = decide('download', local, remote, base);
	if (up.action === 'unchanged') return null;
	if (up.action === 'conflict') return { kind: 'conflict', reason: up.reason };
	if (down.action === 'conflict') return { kind: 'conflict', reason: down.reason };
	if (up.action === 'upload' || up.action === 'delete-remote') {
		return { kind: 'upload', reason: up.reason };
	}
	if (down.action === 'download' || down.action === 'delete-local') {
		return { kind: 'download', reason: down.reason };
	}
	return null;
}

export type FileState = 'unchanged' | 'upload' | 'download' | 'conflict';

export interface FileStatusEntry {
	/** OPFS path of the Beancount file. */
	path: string;
	state: FileState;
	reason?: string;
	/** Present on this device. */
	local: boolean;
	/** In the bucket, and not deleted there. */
	remote: boolean;
}

const hashOf = async (bytes: Uint8Array<ArrayBuffer> | null) => (bytes ? sha256Hex(bytes) : null);

/**
 * Status of every Beancount file, local or in the bucket, in the terms of `decide`. Unlike
 * `fetchFileSyncStatus` it lists the unchanged files too.
 */
export async function listFileStatuses(s: S3Session): Promise<FileStatusEntry[]> {
	const remote = latestRemote(s.manifests);
	const local = await listLocalFiles();
	const paths = new Set([...local.keys()].map((p) => FILES_PREFIX + p));
	for (const p of remote.keys()) if (p.startsWith(FILES_PREFIX)) paths.add(p);

	const entries: FileStatusEntry[] = [];
	for (const path of [...paths].sort()) {
		const opfsPath = path.slice(FILES_PREFIX.length);
		if (!isSafePath(opfsPath)) continue;
		const bytes = await beancountFile(path, local).read();
		const remoteHash = remote.get(path)?.hash ?? null;
		const verdict = classify(
			canonical(s, path, await hashOf(bytes)),
			canonical(s, path, remoteHash),
			s.bases[path] ?? null
		);
		const inBucket = remoteHash !== null && remoteHash !== TOMBSTONE;
		// Gone from both sides: nothing to show.
		if (!bytes && !inBucket) continue;
		entries.push({
			path: opfsPath,
			state: verdict?.kind ?? 'unchanged',
			reason: verdict?.reason,
			local: !!bytes,
			remote: inBucket
		});
	}
	return entries;
}

export interface FileComparison {
	path: string;
	/** Null when the file does not exist on this device. */
	localText: string | null;
	/** Null when the file is absent from the bucket or deleted there. */
	remoteText: string | null;
	localHash: string | null;
	remoteHash: string | null;
	/** The newest manifest entry records another hash than the object in the bucket holds. */
	manifestStale: boolean;
	/** Byte for byte the same. */
	identical: boolean;
	/** The same text, ignoring line endings and the final newline. */
	sameText: boolean;
}

/** Reads both versions of a Beancount file, to see whether they really differ. */
export async function compareFile(s: S3Session, path: string): Promise<FileComparison> {
	const full = FILES_PREFIX + path;
	if (!isSafePath(path)) throw new Error('Unsafe file path');
	const localBytes = await beancountFile(full, await listLocalFiles()).read();

	const entry = latestRemote(s.manifests).get(full);
	let remoteBytes: Uint8Array<ArrayBuffer> | null = null;
	if (entry && entry.hash !== TOMBSTONE) {
		const raw = await getObject(s.cfg, dataKey(full));
		if (!raw) throw new Error('Listed in a manifest but missing from the bucket');
		remoteBytes = await decrypt(s.key, raw);
	}

	const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
	const localHash = await hashOf(localBytes);
	const remoteHash = await hashOf(remoteBytes);
	const localText = text(localBytes);
	const remoteText = text(remoteBytes);
	return {
		path,
		localText,
		remoteText,
		localHash,
		remoteHash,
		manifestStale: remoteHash !== null && !!entry && entry.hash !== remoteHash,
		identical: localHash !== null && localHash === remoteHash,
		sameText:
			localText !== null &&
			remoteText !== null &&
			normalizeEol(localText) === normalizeEol(remoteText)
	};
}

/** Reads both versions of settings.json. `path` is the bucket path, without the files/ prefix. */
export async function compareSettings(s: S3Session): Promise<FileComparison> {
	const localBytes = await settingsFile().read();

	const entry = latestRemote(s.manifests).get(SETTINGS_PATH);
	let remoteBytes: Uint8Array<ArrayBuffer> | null = null;
	if (entry && entry.hash !== TOMBSTONE) {
		const raw = await getObject(s.cfg, dataKey(SETTINGS_PATH));
		if (!raw) throw new Error('Listed in a manifest but missing from the bucket');
		remoteBytes = await decrypt(s.key, raw);
	}

	const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
	const localHash = await hashOf(localBytes);
	const remoteHash = await hashOf(remoteBytes);
	const localText = text(localBytes);
	const remoteText = text(remoteBytes);
	return {
		path: SETTINGS_PATH,
		localText,
		remoteText,
		localHash,
		remoteHash,
		manifestStale: remoteHash !== null && !!entry && entry.hash !== remoteHash,
		identical: localHash !== null && localHash === remoteHash,
		sameText:
			localText !== null &&
			remoteText !== null &&
			normalizeEol(localText) === normalizeEol(remoteText)
	};
}

/**
 * Records that this device's copy and the bucket's hold the same text, so the file stops showing
 * as a conflict. Changes no file and no bucket object. A later change on either side is detected
 * as usual.
 *
 * The comparison read the object that a download would fetch, so its hash is the truth about the
 * bucket. If the newest manifest entry says otherwise (an interrupted upload, or a device whose
 * manifest was written for other content), the manifest is what is wrong, and no refresh can fix
 * it. This device then publishes a newer entry with the object's real hash, which every device
 * picks up as the newest.
 */
export async function markSameContent(
	s: S3Session,
	cmp: FileComparison,
	opts: { persist?: boolean } = {}
): Promise<void> {
	if (!cmp.sameText || !cmp.localHash || !cmp.remoteHash) {
		throw new Error('The two versions differ');
	}
	const path = FILES_PREFIX + cmp.path;
	repairManifest(s, path, cmp.remoteHash);
	s.bases[path] = cmp.localHash;
	s.equiv[path] = { base: cmp.localHash, hashes: [cmp.remoteHash] };
	s.basesDirty = s.equivDirty = true;
	if (opts.persist !== false) await persist(s);
}

/** Writes the changes that `markSameContent(..., { persist: false })` collected. */
export async function persistSession(s: S3Session): Promise<void> {
	await persist(s);
}

/**
 * Dry run for Settings and Beancount files: compares local hashes with the newest manifest
 * entries and the last-synced hashes, without writing anything. Decrypts the manifests, so it
 * needs the passphrase.
 */
export async function fetchFileSyncStatus(cfg: S3Config): Promise<FileSyncOverview> {
	const s = await openSession(cfg);
	const remote = latestRemote(s.manifests);
	const result: FileSyncOverview = {
		settings: { upload: 0, download: 0, conflict: 0 },
		beancount: { upload: 0, download: 0, conflict: 0 }
	};
	const settings = await settingsFile().read();
	const verdict = classify(
		canonical(s, SETTINGS_PATH, await hashOf(settings)),
		canonical(s, SETTINGS_PATH, remote.get(SETTINGS_PATH)?.hash ?? null),
		s.bases[SETTINGS_PATH] ?? null
	);
	if (verdict) result.settings[verdict.kind]++;

	for (const f of await listFileStatuses(s)) {
		if (f.state !== 'unchanged') result.beancount[f.state]++;
	}
	return result;
}

// --- preview ---

/** The decryption key for the configured bucket. Throws `WrongPassphraseError` on mismatch. */
export async function getSyncKey(cfg: S3Config): Promise<CryptoKey> {
	if (!cfg.passphrase) {
		throw new Error('Set an encryption passphrase in the S3 configuration first.');
	}
	return loadKey(cfg);
}

/**
 * Readable content of a bucket object, decrypted on the fly. Yjs state files are shown as the
 * records they hold. Files that are not text are described instead of shown.
 */
export async function previewObject(
	cfg: S3Config,
	key: CryptoKey,
	objectKey: string
): Promise<string> {
	const raw = await getObject(cfg, objectKey);
	if (!raw) throw new Error('The object no longer exists');
	// key.json holds only key-derivation parameters and is not encrypted.
	let bytes: Uint8Array<ArrayBuffer>;
	if (objectKey === 'key.json') bytes = raw;
	else if (objectKey.startsWith('crdt/')) bytes = await decryptCrdtObject(key, objectKey, raw);
	else bytes = await decrypt(key, raw);

	const records = (update: Uint8Array) => {
		const doc = new Y.Doc();
		Y.applyUpdate(doc, update);
		const out: Record<string, unknown> = {};
		for (const name of doc.share.keys()) out[name] = doc.getMap(name).toJSON();
		return out;
	};

	if (objectKey.endsWith('.upd')) {
		// A delta holds changes, not records: show what it reaches, and what it carries.
		const structs = Y.decodeUpdate(bytes).structs;
		return JSON.stringify(
			{
				delta: true,
				structs: structs.length,
				reaches: Object.fromEntries(vectorOf(bytes)),
				records: records(bytes)
			},
			null,
			2
		);
	}
	if (/\/snap-[^/]+\.ydoc$/.test(objectKey)) {
		const { coverage, update } = decodeSnapshot(bytes);
		return JSON.stringify({ coverage, ...records(update) }, null, 2);
	}
	if (objectKey.endsWith('.ydoc')) return JSON.stringify(records(bytes), null, 2);

	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return `[Binary content, ${bytes.length} bytes]`;
	}
	if (objectKey.endsWith('.json')) {
		try {
			return JSON.stringify(JSON.parse(text), null, 2);
		} catch {
			// Show it as it is.
		}
	}
	return text;
}
