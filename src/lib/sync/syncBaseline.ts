/*
	Dexie-backed baseline for peer sync: the content hash recorded as of the
	last successful sync (or hash-confirmed match) with a given endpoint
	(peer). Diff classification (syncDiff.ts) compares a fresh SyncEntry scan
	against this baseline to detect what changed on each side since then.
	Keyed per endpoint (not a singleton) since a device may sync with
	multiple peers. See doc/projects/2026-07-02_beancount-peer-sync.md.
*/
import db from '#lib/data/db';
import { PeerSyncBaseline } from '#lib/data/model';
import type { SyncAnnouncement, SyncEntry } from './SyncSource';

/** All baseline rows for one endpoint, keyed by path. */
export async function getBaseline(endpointId: string): Promise<Map<string, PeerSyncBaseline>> {
	const rows = await db.peerSyncBaseline.where('endpointId').equals(endpointId).toArray();
	return new Map(rows.map((row: PeerSyncBaseline) => [row.path, row]));
}

/** A path's local + remote content snapshot as of the last confirmed sync (pull, merge, or hash match). */
export interface BaselineEntry {
	path: string;
	local: SyncEntry;
	remote: SyncEntry;
}

/** Records (or updates) the baseline for the given paths as just synced. */
export async function updateBaseline(endpointId: string, entries: BaselineEntry[]): Promise<void> {
	if (entries.length === 0) return;
	const syncedAt = new Date().toISOString();
	const rows: PeerSyncBaseline[] = entries.map((e) =>
		Object.assign(new PeerSyncBaseline(), {
			endpointId,
			path: e.path,
			localHash: e.local.hash,
			remoteHash: e.remote.hash,
			syncedAt
		})
	);
	await db.peerSyncBaseline.bulkPut(rows);
}

/** Builds the message telling a peer what this device now holds after a sync (see `recordPeerAnnouncement`). */
export function buildAnnouncement(
	synced: BaselineEntry[],
	deleted: string[]
): SyncAnnouncement {
	return {
		// This device's post-sync copy is `local`; the peer's copy it was based on is `remote`.
		synced: synced.map((e) => ({ path: e.path, hash: e.local.hash, sourceHash: e.remote.hash })),
		deleted
	};
}

/**
 * Records this device's half of a sync the peer just completed (it pulled or
 * merged from us). Only applied while our copy still matches what the peer
 * based its sync on — if we edited the file since, the files genuinely
 * diverged again and no agreement should be recorded.
 */
export async function recordPeerAnnouncement(
	endpointId: string,
	announcement: SyncAnnouncement,
	localEntries: SyncEntry[]
): Promise<void> {
	const byPath = new Map(localEntries.map((e) => [e.path, e]));
	const entries: BaselineEntry[] = [];
	for (const item of announcement.synced) {
		const local = byPath.get(item.path);
		if (!local || local.hash !== item.sourceHash) continue;
		// The peer's copy is only needed for its hash.
		entries.push({ path: item.path, local, remote: { ...local, hash: item.hash } });
	}
	await updateBaseline(endpointId, entries);
	await removeBaselineEntries(
		endpointId,
		announcement.deleted.filter((path) => !byPath.has(path))
	);
}

/** Drops baseline rows for paths no longer worth tracking (e.g. deleted on both sides). */
export async function removeBaselineEntries(endpointId: string, paths: string[]): Promise<void> {
	if (paths.length === 0) return;
	await db.peerSyncBaseline.bulkDelete(paths.map((path) => [endpointId, path]));
}

/** Drops every baseline row for an endpoint (e.g. when trust is revoked). */
export async function clearBaseline(endpointId: string): Promise<void> {
	await db.peerSyncBaseline.where('endpointId').equals(endpointId).delete();
}
