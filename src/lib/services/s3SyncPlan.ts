/**
 * Decision logic for S3 sync of files that can be changed on several devices (settings,
 * Beancount files). No I/O here, so it can be tested on its own.
 *
 * Each device keeps its own manifest in the bucket: the content hash of every file it last
 * uploaded, with the time. The newest entry for a path across all manifests is the "remote"
 * version. The "base" is the hash this device saw at its last sync of that path, the common
 * ancestor that tells a one-sided change from a conflict.
 */

export type SyncDirection = 'upload' | 'download';

/**
 * Manifest hash of a file that was deleted. Not a valid hex digest, so it cannot collide with
 * a real hash. Deletions are propagated by a device writing this in place of the file's hash.
 */
export const TOMBSTONE = 'deleted';

/**
 * `delete-remote` and `delete-local` are never applied automatically: a missing file may just
 * mean the local storage was cleared. The caller asks the user first.
 */
export type SyncAction =
	| 'upload'
	| 'download'
	| 'delete-remote'
	| 'delete-local'
	| 'unchanged'
	| 'skip'
	| 'conflict';

export interface SyncDecision {
	action: SyncAction;
	/** Why the file was skipped, or what the conflict is. */
	reason?: string;
}

export interface ManifestEntry {
	/** Content hash, or `TOMBSTONE` for a deleted file. */
	hash: string;
	/** ISO time of the upload. */
	at: string;
}

export interface Manifest {
	deviceId: string;
	updated: string;
	files: Record<string, ManifestEntry>;
}

/**
 * @param local hash of the local file, null when it does not exist here
 * @param remote hash of the newest remote version, `TOMBSTONE` when it was deleted, null when the
 *   bucket never had it
 * @param base hash at the last sync of this path, null when never synced
 */
export function decide(
	direction: SyncDirection,
	local: string | null,
	remote: string | null,
	base: string | null
): SyncDecision {
	if (local === remote) return { action: 'unchanged' };
	// Gone on both sides.
	if (local === null && remote === TOMBSTONE) return { action: 'unchanged' };

	if (direction === 'upload') {
		if (local === null) {
			// Only a file this device has synced before can have been deleted here.
			if (remote === null || base === null) return { action: 'skip', reason: 'Not on this device' };
			if (remote === base) return { action: 'delete-remote', reason: 'Deleted on this device' };
			return { action: 'conflict', reason: 'Deleted on this device, changed in the bucket' };
		}
		if (remote === TOMBSTONE) {
			if (base === null) return { action: 'upload' };
			if (local === base) {
				return { action: 'skip', reason: 'Deleted in the bucket, download to delete it here' };
			}
			return { action: 'conflict', reason: 'Changed on this device, deleted in the bucket' };
		}
		if (remote === null || remote === base) return { action: 'upload' };
		if (local === base) return { action: 'skip', reason: 'Newer in the bucket, download it first' };
		return { action: 'conflict', reason: 'Changed on this device and in the bucket' };
	}

	if (remote === null) return { action: 'skip', reason: 'Not in the bucket' };
	if (remote === TOMBSTONE) {
		// local is not null here.
		if (base === null) {
			return { action: 'skip', reason: 'Deleted in the bucket, but never synced to this device' };
		}
		if (local === base) return { action: 'delete-local', reason: 'Deleted in the bucket' };
		return { action: 'conflict', reason: 'Changed on this device, deleted in the bucket' };
	}
	if (local === null || local === base) return { action: 'download' };
	if (remote === base) return { action: 'skip', reason: 'Newer on this device, upload it first' };
	return { action: 'conflict', reason: 'Changed on this device and in the bucket' };
}

/** The newest manifest entry for each path, across all devices. */
export function latestRemote(manifests: Manifest[]): Map<string, ManifestEntry> {
	const latest = new Map<string, ManifestEntry>();
	for (const m of manifests) {
		for (const [path, entry] of Object.entries(m.files)) {
			const current = latest.get(path);
			if (!current || entry.at > current.at) latest.set(path, entry);
		}
	}
	return latest;
}

/**
 * Paths come from the bucket, so a hostile or damaged manifest must not be able to write
 * outside the ledger folder or into Cashier's own cache folder.
 */
export function isSafePath(path: string): boolean {
	if (!path || path.startsWith('/') || path.includes('\\')) return false;
	const parts = path.split('/');
	if (parts.some((p) => p === '' || p === '.' || p === '..')) return false;
	return !parts[0].startsWith('.cashier');
}
