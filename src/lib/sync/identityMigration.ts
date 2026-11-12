/**
 * Moving a trusted device from its legacy UUID to the ID derived from its key (doc/projects/
 * 2026-11-11_device-identity.md, steps 5b and 5c).
 *
 * When a device switches, the others find their record of it by what it can prove:
 * - `rekey`: a record with the same key under the old ID. The new hello is signed by that very
 *   key, so it is the same device; the record is re-keyed without asking.
 * - `approve`: a record without a key (trusted through S3 or WebDAV) that the device names as its
 *   `previousId`. Nothing proves that, so a person confirms it, comparing name and fingerprint.
 *
 * Re-keying keeps the old UUID in `legacyIds`, so what the device wrote under it stays readable
 * until it is forgotten.
 */
import db from '#lib/data/db';
import { PeerSyncBaseline, TrustedPeer } from '#lib/data/model';
import { fingerprintOfKey } from '#lib/sync/deviceKey';
import { isDerivedId } from '#lib/sync/deviceId';

export type LegacyMatch = { kind: 'rekey' | 'approve'; record: TrustedPeer };

/** The trusted record of a device by its ID, current or legacy. */
export function peerOf<T extends { id: string; legacyIds?: string[] }>(
	peers: T[],
	deviceId: string | null | undefined
): T | undefined {
	return deviceId
		? peers.find((p) => p.id === deviceId || p.legacyIds?.includes(deviceId))
		: undefined;
}

/**
 * The record that a device with a key-derived ID replaces, if any. `subject.id` must already be
 * checked against `publicKey`. Nothing when the device is trusted under its new ID already.
 */
export function matchLegacy(
	subject: { id: string; publicKey: string; previousId?: string },
	peers: TrustedPeer[]
): LegacyMatch | null {
	if (!isDerivedId(subject.id) || peers.some((p) => p.id === subject.id)) return null;
	const sameKey = peers.find((p) => p.publicKey === subject.publicKey);
	if (sameKey) return { kind: 'rekey', record: sameKey };
	if (!subject.previousId) return null;
	const named = peers.find(
		(p) =>
			!p.publicKey && (p.id === subject.previousId || p.legacyIds?.includes(subject.previousId!))
	);
	return named ? { kind: 'approve', record: named } : null;
}

/**
 * Replaces a trusted record by the same device under its key-derived ID, in one transaction, and
 * moves what is keyed by the old ID: the Beancount sync baselines. The label, read-only flag,
 * `addedBy` and trust date are kept; the old ID joins `legacyIds`.
 */
export async function replaceTrustedRecord(
	oldId: string,
	next: { id: string; name: string; publicKey: string }
): Promise<TrustedPeer | null> {
	const fingerprint = await fingerprintOfKey(next.publicKey);
	return db.transaction('rw', db.peers, db.peerSyncBaseline, async () => {
		const old: TrustedPeer | undefined = await db.peers.get(oldId);
		if (!old) return null;
		const tp = Object.assign(new TrustedPeer(), old, {
			id: next.id,
			announcedName: next.name,
			publicKey: next.publicKey,
			fingerprint,
			legacyIds: [...new Set([...(old.legacyIds ?? []), oldId])]
		});
		await db.peers.delete(oldId);
		await db.peers.put(tp);

		const rows: PeerSyncBaseline[] = await db.peerSyncBaseline
			.where('endpointId')
			.equals(oldId)
			.toArray();
		if (rows.length) {
			await db.peerSyncBaseline.bulkDelete(rows.map((r) => [r.endpointId, r.path]));
			await db.peerSyncBaseline.bulkPut(rows.map((r) => ({ ...r, endpointId: next.id })));
		}
		return tp;
	});
}
