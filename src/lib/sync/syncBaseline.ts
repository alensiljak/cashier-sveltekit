/*
	Dexie-backed baseline for peer sync: the file metadata (size/lastModified)
	recorded as of the last successful sync with a given endpoint (peer). Diff
	classification (syncDiff.ts) compares a fresh SyncEntry scan against this
	baseline to detect what changed on each side since then. Keyed per
	endpoint (not a singleton) since a device may sync with multiple peers.
	See doc/projects/2026-07-02_beancount-peer-sync.md.
*/
import db from '$lib/data/db';
import { PeerSyncBaseline } from '$lib/data/model';
import type { SyncEntry } from './SyncSource';

/** All baseline rows for one endpoint, keyed by path. */
export async function getBaseline(endpointId: string): Promise<Map<string, PeerSyncBaseline>> {
	const rows = await db.peerSyncBaseline.where('endpointId').equals(endpointId).toArray();
	return new Map(rows.map((row: PeerSyncBaseline) => [row.path, row]));
}

/** A path's local + remote metadata snapshot as of the last confirmed sync (pull or hash-verify). */
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
			localSize: e.local.size,
			localModified: e.local.lastModified,
			remoteSize: e.remote.size,
			remoteModified: e.remote.lastModified,
			syncedAt
		})
	);
	await db.peerSyncBaseline.bulkPut(rows);
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
