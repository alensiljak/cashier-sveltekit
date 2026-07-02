/*
	Diff classification for the generic beancount peer-sync engine: compares a
	local and remote SyncEntry scan against the last-synced baseline
	(syncBaseline.ts) to classify each path. v1 is download-only, so the
	'push' outcome from the project doc's Future section doesn't exist yet.
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
 * A side "changed" when its current metadata doesn't match the baseline
 * recorded at the last sync. A missing baseline (this path was never synced
 * with this endpoint before) counts as changed too — there's nothing to
 * confirm it matches, so it can't be reported unchanged. A side that no
 * longer has the file, but did at the last sync, also counts as changed
 * (deletion).
 */
function changedSinceBaseline(
	entry: SyncEntry | undefined,
	baseline: PeerSyncBaseline | undefined
): boolean {
	if (!entry) return baseline !== undefined;
	if (!baseline) return true;
	return entry.size !== baseline.size || entry.lastModified !== baseline.lastModified;
}

function classify(localChanged: boolean, remoteChanged: boolean): SyncStatus {
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
 * endpoint's baseline. Metadata-only — never hashes; a 'conflict' row's
 * "Verify" action (hashFile on both sides) is a separate, explicit step.
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
		const base = baseline.get(path);
		const status = classify(
			changedSinceBaseline(localEntry, base),
			changedSinceBaseline(remoteEntry, base)
		);
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
