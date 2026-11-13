/**
 * Per-file status and comparison of Settings and Beancount files against the bucket, in the
 * terms of `decide` (s3SyncPlan.ts). Read-only apart from `markSameContent`.
 */
import { normalizeEol } from '#lib/sync/SyncSource';
import { getObject } from './s3Client';
import type { S3Config } from './s3Config';
import { decrypt } from './s3Crypto';
import { beancountFile, listLocalFiles, repairManifest, settingsFile } from './s3Files';
import {
	canonical,
	dataKey,
	FILES_PREFIX,
	hashOf,
	openSession,
	persist,
	SETTINGS_PATH,
	type S3Session
} from './s3Session';
import { decide, isSafePath, latestRemote, TOMBSTONE } from './s3SyncPlan';
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
): { kind: 'upload' | 'download' | 'conflict'; reason?: string; unrelated?: boolean } | null {
	const up = decide('upload', local, remote, base);
	const down = decide('download', local, remote, base);
	if (up.action === 'unchanged') return null;
	if (up.action === 'conflict') {
		return { kind: 'conflict', reason: up.reason, unrelated: up.unrelated };
	}
	if (down.action === 'conflict') {
		return { kind: 'conflict', reason: down.reason, unrelated: down.unrelated };
	}
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
	/** A `conflict` that is only "differs": never synced, so it is not known which side is newer. */
	unrelated?: boolean;
	/** Present on this device. */
	local: boolean;
	/** In the bucket, and not deleted there. */
	remote: boolean;
}

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
			unrelated: verdict?.unrelated,
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
