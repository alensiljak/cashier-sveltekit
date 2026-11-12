/**
 * Evicting a device (doc/projects/2026-11-11_device-identity.md, step 6): a signed revocation
 * record that spreads between devices, with no server.
 *
 * Any trusted, non-read-only device can evict another. The record says "I, `by`, evict `revoked`"
 * and is signed with the evictor's key. A receiver accepts it only from a device it trusts, keeps
 * a tombstone (the `revocations` table) and drops the device from its trusted list, so gossip or
 * an old invite cannot bring it back. A person pairing with the device again clears the tombstone;
 * records older than that are then ignored.
 *
 * Eviction is not a data wipe: the evicted device keeps what it already has, and still holds the
 * bucket passphrase. What changes is that nobody merges from it or serves it any more.
 */
import db from '#lib/data/db';
import { Revocation, type RevocationRecord, type TrustedPeer } from '#lib/data/model';
import { fingerprintOfKey, signMessage, verifyMessage, type DeviceKey } from '#lib/sync/deviceKey';
import { peerOf } from '#lib/sync/identityMigration';

export type { RevocationRecord };

const REVOKE_TAG = 'cashier-revoke-v1';
const MAX_ID_LENGTH = 64;
/** More than this in one message is not a group of devices. */
export const MAX_REVOCATIONS_PER_MESSAGE = 100;

function revokeMessage(revoked: string, by: string, at: number): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(JSON.stringify([REVOKE_TAG, revoked, by, at]));
}

export async function signRevocation(
	key: DeviceKey,
	by: string,
	revoked: string,
	at: number = Date.now()
): Promise<RevocationRecord> {
	return {
		v: 1,
		revoked,
		by,
		at,
		sig: await signMessage(key.privateKey, revokeMessage(revoked, by, at))
	};
}

export function verifyRevocation(record: RevocationRecord, evictorKey: string): Promise<boolean> {
	return verifyMessage(evictorKey, record.sig, revokeMessage(record.revoked, record.by, record.at));
}

export function isRevocationRecord(raw: unknown): raw is RevocationRecord {
	if (!raw || typeof raw !== 'object') return false;
	const r = raw as Record<string, unknown>;
	return (
		r.v === 1 &&
		typeof r.revoked === 'string' &&
		r.revoked.length > 0 &&
		r.revoked.length <= MAX_ID_LENGTH &&
		typeof r.by === 'string' &&
		r.by.length > 0 &&
		r.by.length <= MAX_ID_LENGTH &&
		typeof r.at === 'number' &&
		Number.isFinite(r.at) &&
		typeof r.sig === 'string' &&
		r.sig.length > 0 &&
		r.sig.length <= 200
	);
}

/** The IDs with an active eviction (not cleared by pairing again). */
export function evictedIds(tombstones: Revocation[]): Set<string> {
	return new Set(tombstones.filter((t) => t.status === 'evicted').map((t) => t.id));
}

export interface AcceptContext {
	/** This device's ID. */
	myId: string;
	trusted: TrustedPeer[];
	tombstones: Revocation[];
}

export interface AcceptedRevocation {
	record: RevocationRecord;
	/** The trusted record of the evictor, as this device has it. */
	evictor: TrustedPeer;
	/** The trusted record that is evicted; null when the device was not trusted here. */
	subject: TrustedPeer | null;
	/** The record evicts this device itself. */
	self: boolean;
}

/**
 * Checks what arrived and returns the records that are new here and hold:
 *
 * - the evictor is trusted with a key and not read-only, and the signature is its own;
 * - the evictor does not evict itself;
 * - the device is not already tombstoned, and the record is newer than any re-pairing with it.
 *
 * The caller has already made sure the message came from a connection or store it may read.
 */
export async function acceptRevocations(
	raw: unknown,
	ctx: AcceptContext
): Promise<AcceptedRevocation[]> {
	if (!Array.isArray(raw) || raw.length > MAX_REVOCATIONS_PER_MESSAGE) return [];
	const known = new Map(ctx.tombstones.map((t) => [t.id, t]));
	const accepted: AcceptedRevocation[] = [];
	const seen = new Set<string>();

	for (const record of raw) {
		if (!isRevocationRecord(record)) continue;
		const evictor = peerOf(ctx.trusted, record.by);
		if (!evictor?.publicKey || evictor.readOnly) continue;
		// A record names the evictor by an ID it held when it signed; it may have switched since.
		if (record.revoked === evictor.id || evictor.legacyIds?.includes(record.revoked)) continue;
		const subject = peerOf(ctx.trusted, record.revoked) ?? null;
		const existing = known.get(record.revoked);
		if (existing?.status === 'evicted') continue;
		if (existing?.readmittedAt && record.at <= Date.parse(existing.readmittedAt)) continue;
		if (seen.has(record.revoked)) continue;
		if (!(await verifyRevocation(record, evictor.publicKey))) continue;
		seen.add(record.revoked);
		accepted.push({
			record,
			evictor,
			subject,
			self: record.revoked === ctx.myId
		});
	}
	return accepted;
}

/**
 * Applies an accepted eviction in one transaction: a tombstone for the device's ID (and each
 * legacy ID of its trusted record), the trusted record, its Beancount sync baselines and any
 * pending introduction of its key are removed. Returns the tombstones written.
 */
export async function applyRevocation(
	accepted: AcceptedRevocation,
	now: Date = new Date()
): Promise<Revocation[]> {
	const { record, evictor, subject } = accepted;
	const ids = [
		...new Set([record.revoked, ...(subject ? [subject.id, ...(subject.legacyIds ?? [])] : [])])
	];
	const fingerprint =
		subject?.fingerprint || (subject?.publicKey ? await fingerprintOfKey(subject.publicKey) : '');
	const rows = ids.map((id) =>
		Object.assign(new Revocation(), {
			id,
			status: 'evicted' as const,
			record,
			name: subject?.name ?? '',
			fingerprint,
			byName: evictor.name,
			receivedAt: now.toISOString(),
			seen: false
		})
	);
	await db.transaction(
		'rw',
		db.peers,
		db.peerSyncBaseline,
		db.introductions,
		db.revocations,
		async () => {
			await db.revocations.bulkPut(rows);
			if (subject) {
				await db.peers.delete(subject.id);
				await db.peerSyncBaseline.where('endpointId').anyOf(ids).delete();
			}
			// A request to trust the device is dropped, whether or not it was trusted.
			for (const intro of await db.introductions.toArray()) {
				if (
					ids.includes(intro.id) ||
					ids.includes(intro.subjectId) ||
					(subject?.publicKey && intro.publicKey === subject.publicKey)
				) {
					await db.introductions.delete(intro.id);
				}
			}
		}
	);
	return rows;
}

/** A person paired with an evicted device again: its tombstone stops counting, and older records are ignored. */
export async function clearTombstones(ids: string[], now: Date = new Date()): Promise<void> {
	await db.transaction('rw', db.revocations, async () => {
		for (const id of ids) {
			const row: Revocation | undefined = await db.revocations.get(id);
			if (row?.status !== 'evicted') continue;
			row.status = 'readmitted';
			row.readmittedAt = now.toISOString();
			row.seen = true;
			await db.revocations.put(row);
		}
	});
}

/** The records to pass on to a device: every active eviction, once per signed record. */
export function recordsToShare(tombstones: Revocation[]): RevocationRecord[] {
	const bySig = new Map<string, RevocationRecord>();
	for (const t of tombstones) if (t.status === 'evicted') bySig.set(t.record.sig, t.record);
	return [...bySig.values()];
}
