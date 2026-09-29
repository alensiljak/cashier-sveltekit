/*
	Applies a download-only pull of ledger files from a peer into local OPFS and
	records the result in the sync baseline. Shared by /sync/beancount (per-file
	selection) and /peer-sync (pull-all-newer shortcut).
*/
import type { SyncEntry, SyncSource } from './SyncSource';
import { removeBaselineEntries, updateBaseline, type BaselineEntry } from './syncBaseline';

export interface PullResult {
	/** Local scan taken after the writes (baseline records each file's real post-write hash). */
	freshLocal: SyncEntry[];
	failures: string[];
}

/**
 * @param rows Files to pull; `remote` absent means the peer no longer has the file, so the local copy is deleted.
 */
export async function pullFiles(
	peerId: string,
	remoteSource: SyncSource,
	localSource: SyncSource,
	rows: { path: string; remote?: SyncEntry }[]
): Promise<PullResult> {
	const pulledRemote = new Map<string, SyncEntry>();
	const baselineRemovals: string[] = [];
	const failures: string[] = [];

	for (const row of rows) {
		try {
			if (row.remote) {
				const content = await remoteSource.readFile(row.path);
				if (content === undefined) {
					// Peer no longer has it (race since the list was fetched) — mirror the deletion.
					await localSource.deleteFile(row.path);
					baselineRemovals.push(row.path);
				} else {
					await localSource.writeFile(row.path, content);
					pulledRemote.set(row.path, row.remote);
				}
			} else {
				// Remote no longer has this file — pulling mirrors the deletion locally.
				await localSource.deleteFile(row.path);
				baselineRemovals.push(row.path);
			}
		} catch (e) {
			failures.push(`${row.path}: ${(e as Error).message}`);
		}
	}

	// Re-scan local so the baseline records each pulled file's actual post-write
	// hash (writeFile doesn't hand it back); paired with the remote entry from
	// this pull, both sides then read back as unchanged next time.
	const freshLocal = await localSource.listTree();
	const baselineUpserts: BaselineEntry[] = [];
	for (const [path, remote] of pulledRemote) {
		const local = freshLocal.find((e) => e.path === path);
		if (local) baselineUpserts.push({ path, local, remote });
	}

	if (baselineUpserts.length) await updateBaseline(peerId, baselineUpserts);
	if (baselineRemovals.length) await removeBaselineEntries(peerId, baselineRemovals);

	return { freshLocal, failures };
}
