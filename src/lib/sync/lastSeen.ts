/**
 * `TrustedPeer.lastSeen` from what a bucket or folder shows: the newest modification date of
 * anything a trusted device wrote (delta, acknowledgement, manifest), under its current ID or a
 * legacy one. It only ever moves forward, and it is informational: server dates are not trusted
 * for anything (see doc/projects/2026-11-11_device-identity.md, "Last seen").
 */
import db from '#lib/data/db';

export interface Listed {
	deviceId: string | null;
	lastModified: Date | null;
}

/** A device not seen for this long is offered for removal (same window as the delta-sync ack window). */
export const UNSEEN_WINDOW_MS = 30 * 24 * 3600 * 1000;

/**
 * Trusted devices not seen for `windowMs`. A device that was never seen counts from when it was
 * trusted, so a freshly paired one is not offered. Local housekeeping only, not an eviction.
 */
export function unseenDevices<T extends { lastSeen?: string; trustedAt: string }>(
	peers: T[],
	now: number = Date.now(),
	windowMs: number = UNSEEN_WINDOW_MS
): T[] {
	return peers.filter((p) => {
		const t = Date.parse(p.lastSeen || p.trustedAt);
		// An unparseable date is not evidence of absence: keep the device.
		return Number.isFinite(t) && now - t > windowMs;
	});
}

/** Moves `lastSeen` of the trusted devices forward to the newest object each wrote. Returns how many changed. */
export async function noteBucketActivity(items: Listed[]): Promise<number> {
	const newest = new Map<string, number>();
	for (const { deviceId, lastModified } of items) {
		const t = lastModified?.getTime();
		if (!deviceId || t === undefined || !Number.isFinite(t)) continue;
		newest.set(deviceId, Math.max(newest.get(deviceId) ?? 0, t));
	}
	if (!newest.size) return 0;

	let changed = 0;
	for (const peer of await db.peers.toArray()) {
		let seen = 0;
		for (const id of [peer.id, ...(peer.legacyIds ?? [])])
			seen = Math.max(seen, newest.get(id) ?? 0);
		const known = peer.lastSeen ? Date.parse(peer.lastSeen) : 0;
		if (seen > (Number.isFinite(known) ? known : 0)) {
			await db.peers.update(peer.id, { lastSeen: new Date(seen).toISOString() });
			changed++;
		}
	}
	return changed;
}
