/*
	What the Sync hub and the home Sync card need to know about a sync channel (WebDAV, S3,
	peer-to-peer), and the pure rules for judging a set of channels. The adapters that wrap the
	real services are in channels.ts; the cached state is in syncHub.svelte.ts.
*/

export type ChannelId = 'webdav' | 's3' | 'peer';

/** unchecked = not compared yet; differs = there are changes to exchange. */
export type ChannelStatus = 'unchecked' | 'checking' | 'same' | 'differs' | 'error';

/** The last known state of a channel. Never fetched on its own: see SyncHub. */
export interface ChannelSnapshot {
	status: ChannelStatus;
	/** When the status was last determined, or null if it never was in this session. */
	checkedAt: Date | null;
	/** When a sync last completed on this device. */
	lastSync: Date | null;
	/** Why the last check or sync failed, when `status` is `error`. */
	error?: string;
	/** A sync is running. */
	busy: boolean;
}

export interface SyncResult {
	ok: boolean;
	/** Working-set records came in, so the ledger needs a reload. */
	merged: boolean;
	errors: string[];
}

export interface SyncChannel {
	id: ChannelId;
	label: string;
	/** The detail page. */
	href: string;
	/** Whether the user turned this channel on (Settings → Backup & Sync). */
	isEnabled(): boolean;
	/** Why the channel cannot check or sync right now (not connected, no peers), or null if it can. */
	unavailableReason(): string | null;
	/** Compares this device with the other side without changing anything. Throws on failure. */
	check(): Promise<'same' | 'differs'>;
	/** Merges and uploads the CRDT stores. Throws on failure; per-item failures go in `errors`. */
	sync(): Promise<Omit<SyncResult, 'ok'>>;
	/** The channel's own record of its last sync, when it keeps one. */
	lastSync?(): Promise<Date | null>;
}

export const emptySnapshot = (): ChannelSnapshot => ({
	status: 'unchecked',
	checkedAt: null,
	lastSync: null,
	busy: false
});

/** A week: how long without any completed sync before the hub warns. */
export const DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** True when the last sync is unknown or older than `maxAgeMs`. */
export function isStale(lastSync: Date | null, now: Date, maxAgeMs = DEFAULT_STALE_MS): boolean {
	return lastSync === null || now.getTime() - lastSync.getTime() > maxAgeMs;
}

/**
 * - none: no channel is enabled
 * - error: a check or sync failed
 * - attention: some channel has changes to exchange
 * - ok: at least one channel is confirmed in sync or synced recently
 * - stale: nothing is confirmed, and nothing has synced within `maxAgeMs`
 */
export type OverallState = 'none' | 'error' | 'attention' | 'ok' | 'stale';

export function overallState(
	snapshots: ChannelSnapshot[],
	now: Date,
	maxAgeMs = DEFAULT_STALE_MS
): OverallState {
	if (snapshots.length === 0) return 'none';
	if (snapshots.some((s) => s.status === 'error')) return 'error';
	if (snapshots.some((s) => s.status === 'differs')) return 'attention';
	if (snapshots.some((s) => s.status === 'same' || !isStale(s.lastSync, now, maxAgeMs)))
		return 'ok';
	return 'stale';
}

/** The most recent completed sync across channels, or null if none is known. */
export function newestSync(snapshots: ChannelSnapshot[]): Date | null {
	return snapshots.reduce<Date | null>(
		(a, s) => (s.lastSync && (!a || s.lastSync > a) ? s.lastSync : a),
		null
	);
}

/** "just now", "5 minutes ago", "3 days ago", or "never" for a time that is not known. */
export function formatAge(at: Date | null, now: Date): string {
	if (!at) return 'never';
	const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
	if (seconds < 60) return 'just now';
	const unit = (n: number, name: string) => `${n} ${name}${n === 1 ? '' : 's'} ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return unit(minutes, 'minute');
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return unit(hours, 'hour');
	return unit(Math.floor(hours / 24), 'day');
}
