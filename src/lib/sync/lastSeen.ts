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
