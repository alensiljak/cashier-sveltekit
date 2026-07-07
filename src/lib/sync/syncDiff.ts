/*
	Diff classification for the generic beancount peer-sync engine: compares a
	local and remote SyncEntry scan against the last-synced baseline
	(syncBaseline.ts) to classify each path. Classification is content-hash
	based, not filesystem-mtime based — a device's mtime is not a reliable
	change signal across peers (clock skew, a resync rewriting
	byte-identical content, editors touching a file without changing it), so
	every scan hashes both sides and only a real content difference can ever
	produce anything but 'unchanged'. v1 is download-only, so the 'push'
	outcome from the project doc's Future section doesn't exist yet.
	See doc/projects/2026-07-02_beancount-peer-sync.md.
*/
import type { PeerSyncBaseline } from '$lib/data/model';
import type { SyncEntry } from './SyncSource';

export type SyncStatus = 'unchanged' | 'local-newer' | 'remote-newer' | 'conflict';

/** Source-agnostic rename of opfs/sync's fs/opfs-specific SyncAction — 'push' is a later phase. */
export type SyncAction = 'pull' | 'conflict' | 'skip';

export interface DiffEntry {
	path: string;
	status: SyncStatus;
	/** Default action implied by status; v1 offers no push, so callers may only toggle pull ⇄ skip. */
	action: SyncAction;
	local?: SyncEntry;
	remote?: SyncEntry;
}

/**
 * A side "changed" when its current hash doesn't match *that side's* half
 * of the baseline recorded at the last sync — local and remote are compared
 * against separate baseline halves (see PeerSyncBaseline's doc comment), not
 * against each other's, because a manual merge can leave the two sides
 * holding deliberately different, reconciled content. A missing baseline
 * half (this path/side was never synced with this endpoint before) counts
 * as changed too — there's nothing to confirm it matches, so it can't be
 * reported unchanged. A side that no longer has the file, but did at the
 * last sync, also counts as changed (deletion).
 */
function changedSinceBaseline(
	entry: SyncEntry | undefined,
	baselineHash: string | undefined
): boolean {
	if (!entry) return baselineHash !== undefined;
	if (baselineHash === undefined) return true;
	return entry.hash !== baselineHash;
}

/**
 * Local and remote holding byte-identical content is always 'unchanged',
 * regardless of baseline state — this is what used to require a manual
 * "Verify" round trip; now every scan re-derives it for free from the hash
 * already computed during listTree(). Only once the hashes actually differ
 * does baseline history decide which side(s) diverged.
 */
function classify(
	local: SyncEntry | undefined,
	remote: SyncEntry | undefined,
	baseline: PeerSyncBaseline | undefined
): SyncStatus {
	if (local && remote && local.hash === remote.hash) return 'unchanged';

	const localChanged = changedSinceBaseline(local, baseline?.localHash);
	const remoteChanged = changedSinceBaseline(remote, baseline?.remoteHash);
	if (localChanged && remoteChanged) return 'conflict';
	if (remoteChanged) return 'remote-newer';
	if (localChanged) return 'local-newer';
	return 'unchanged';
}

function defaultActionFor(status: SyncStatus): SyncAction {
	// 'local-newer' has no push in v1, so the only meaningful action is skip;
	// 'conflict' can only be pulled (overwrite local) or skipped — never pushed.
	return status === 'remote-newer' ? 'pull' : status === 'conflict' ? 'conflict' : 'skip';
}

/**
 * Classifies every path present locally and/or remotely against the given
 * endpoint's baseline. Hash-based: identical content on both sides is
 * always 'unchanged' outright; otherwise each side's hash is checked
 * against its own baseline half to tell which side(s) actually diverged.
 */
export function diffAgainstBaseline(
	local: SyncEntry[],
	remote: SyncEntry[],
	baseline: Map<string, PeerSyncBaseline>
): DiffEntry[] {
	const byPath = new Map<string, { local?: SyncEntry; remote?: SyncEntry }>();
	for (const e of local) byPath.set(e.path, { ...byPath.get(e.path), local: e });
	for (const e of remote) byPath.set(e.path, { ...byPath.get(e.path), remote: e });

	const result: DiffEntry[] = [];
	for (const [path, { local: localEntry, remote: remoteEntry }] of byPath) {
		const status = classify(localEntry, remoteEntry, baseline.get(path));
		result.push({
			path,
			status,
			action: defaultActionFor(status),
			local: localEntry,
			remote: remoteEntry
		});
	}

	return result.sort((a, b) => a.path.localeCompare(b.path));
}
