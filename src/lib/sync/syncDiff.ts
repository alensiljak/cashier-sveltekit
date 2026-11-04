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
import type { PeerSyncBaseline } from '#lib/data/model';
import type { SyncEntry } from './SyncSource';
import { compareToBase } from './threeWay';

/**
 * 'differs' = both sides have the file with different content and there is no
 * sync history for it with this endpoint, so there is no common ancestor to say
 * who is newer (unlike 'conflict', which proves both sides changed). Resolved
 * by comparing content; the first confirmed sync records the baseline.
 */
export type SyncStatus = 'unchanged' | 'local-newer' | 'remote-newer' | 'conflict' | 'differs';

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
 * Maps the channel-independent comparison (threeWay.ts) onto peer statuses.
 * Byte-identical content is 'unchanged' regardless of baseline state; once the
 * hashes differ, each side is judged against its own baseline half (see
 * PeerSyncBaseline's doc comment), and a path with no baseline is 'differs'.
 */
function classify(
	local: SyncEntry | undefined,
	remote: SyncEntry | undefined,
	baseline: PeerSyncBaseline | undefined
): SyncStatus {
	const change = compareToBase(
		local?.hash ?? null,
		remote?.hash ?? null,
		baseline ? { local: baseline.localHash, remote: baseline.remoteHash } : null
	);
	switch (change) {
		case 'both':
			return 'conflict';
		case 'remote':
			return 'remote-newer';
		case 'local':
			return 'local-newer';
		case 'unrelated':
			return 'differs';
		default:
			return 'unchanged';
	}
}

function defaultActionFor(status: SyncStatus): SyncAction {
	// 'local-newer' has no push in v1, so the only meaningful action is skip;
	// 'conflict' can only be pulled (overwrite local) or skipped — never pushed.
	if (status === 'remote-newer') return 'pull';
	// 'differs' stays unresolved like a conflict until the user compares and chooses.
	return status === 'conflict' || status === 'differs' ? 'conflict' : 'skip';
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
