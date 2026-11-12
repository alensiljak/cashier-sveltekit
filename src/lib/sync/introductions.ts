/**
 * Introductions (doc/projects/2026-11-11_device-identity.md, step 4): a trusted device vouches for
 * another one, so a new device does not have to be invited by every device of the group.
 *
 * An introduction is only a **proposal**. It says "I, device A, vouch for this key under this name",
 * signed with A's key. The device that receives it queues a request, and trusts the subject only
 * after a person approves it there. Every device decides for itself whom it syncs with, and the new
 * device chooses among the devices its introducer trusts the same way.
 *
 * Introductions travel over the sync room between devices that already trust each other (see
 * `PeerPresence`), so the receiver knows who sent one and checks the signature against that device.
 */
import type { PendingIntroduction, TrustedPeer } from '#lib/data/model';
import {
	deviceIdFromPublicKey,
	fingerprintOfKey,
	signMessage,
	verifyMessage,
	type DeviceKey
} from '#lib/sync/deviceKey';
import { isDerivedId } from '#lib/sync/signedObjects';

const INTRO_TAG = 'cashier-intro-v1';
const MAX_NAME_LENGTH = 100;
const MAX_ID_LENGTH = 64;
/** More than this in one message is not a group of devices. */
export const MAX_INTRODUCTIONS_PER_MESSAGE = 50;

export type IntroductionSubject = {
	/** The device ID the subject announces in its hello. */
	id: string;
	name: string;
	publicKey: string;
};

export type Introduction = {
	v: 1;
	subject: IntroductionSubject;
	/** The ID of the device that vouches. */
	by: string;
	/** ms since the epoch. Part of the signature. */
	at: number;
	sig: string;
};

/**
 * The signed bytes. The subject's ID is covered too: while IDs are still announced rather than
 * derived from the key, it decides which trust record the approval creates.
 */
function introMessage(
	subject: IntroductionSubject,
	by: string,
	at: number
): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(
		JSON.stringify([INTRO_TAG, by, subject.id, subject.name, subject.publicKey, at])
	);
}

export async function signIntroduction(
	key: DeviceKey,
	by: string,
	subject: IntroductionSubject,
	at: number = Date.now()
): Promise<Introduction> {
	const { id, name, publicKey } = subject;
	return {
		v: 1,
		subject: { id, name, publicKey },
		by,
		at,
		sig: await signMessage(key.privateKey, introMessage(subject, by, at))
	};
}

export function verifyIntroduction(intro: Introduction, introducerKey: string): Promise<boolean> {
	return verifyMessage(introducerKey, intro.sig, introMessage(intro.subject, intro.by, intro.at));
}

/** Introductions this device offers `recipient`: every other trusted device it holds a key for. */
export async function introductionsFor(
	recipientId: string,
	me: { id: string; key: DeviceKey },
	trusted: TrustedPeer[],
	at: number = Date.now()
): Promise<Introduction[]> {
	const subjects = trusted.filter((p) => p.id !== recipientId && p.publicKey);
	return Promise.all(
		subjects.map((p) =>
			signIntroduction(
				me.key,
				me.id,
				// The subject is introduced under the name it announced, not this device's private label.
				{ id: p.id, name: p.announcedName || p.name, publicKey: p.publicKey! },
				at
			)
		)
	);
}

function isIntroduction(raw: unknown): raw is Introduction {
	if (!raw || typeof raw !== 'object') return false;
	const i = raw as Record<string, unknown>;
	const s = i.subject as Record<string, unknown> | undefined;
	return (
		i.v === 1 &&
		typeof i.by === 'string' &&
		i.by.length <= MAX_ID_LENGTH &&
		typeof i.at === 'number' &&
		Number.isFinite(i.at) &&
		typeof i.sig === 'string' &&
		!!s &&
		typeof s === 'object' &&
		typeof s.id === 'string' &&
		s.id.length > 0 &&
		s.id.length <= MAX_ID_LENGTH &&
		typeof s.name === 'string' &&
		s.name.length <= MAX_NAME_LENGTH &&
		typeof s.publicKey === 'string' &&
		s.publicKey.length > 0 &&
		s.publicKey.length <= 500
	);
}

export interface ReceiveContext {
	/** This device. */
	me: { id: string; publicKey: string };
	/** The trusted device that sent the message, as this device has it on record. */
	introducer: TrustedPeer;
	trusted: TrustedPeer[];
	pending: PendingIntroduction[];
	/** IDs of evicted devices (see revocations.ts): an introduction of one is refused. */
	evicted?: ReadonlySet<string>;
	now?: number;
}

/**
 * Checks what a trusted device sent and returns the requests to store (new ones, and existing
 * ones that gained an introducer). Ignores whatever does not hold:
 *
 * - the sender must be trusted with a key and not read-only (this device does not take its word);
 * - it must be the one that signed, with a valid signature;
 * - the subject is not this device and not already trusted under that key;
 * - a subject that claims an ID this device already trusts with another key is refused;
 * - a subject that was evicted (`evicted`) is refused.
 *
 * The caller has already made sure the message came over a connection the sender proved its key on.
 */
export async function receiveIntroductions(
	raw: unknown,
	ctx: ReceiveContext
): Promise<PendingIntroduction[]> {
	const { introducer, trusted, me } = ctx;
	if (!introducer.publicKey || introducer.readOnly) return [];
	if (!Array.isArray(raw) || raw.length > MAX_INTRODUCTIONS_PER_MESSAGE) return [];

	const byKey = new Map(ctx.pending.map((p) => [p.id, structuredClone(p)]));
	const changed = new Map<string, PendingIntroduction>();
	const received = new Date(ctx.now ?? Date.now()).toISOString();

	for (const intro of raw) {
		if (!isIntroduction(intro) || intro.by !== introducer.id) continue;
		if (!(await verifyIntroduction(intro, introducer.publicKey))) continue;

		const { subject } = intro;
		if (subject.publicKey === me.publicKey || subject.id === me.id) continue;
		const known = trusted.find((p) => p.id === subject.id);
		if (known?.publicKey && known.publicKey !== subject.publicKey) continue;
		if (trusted.some((p) => p.publicKey === subject.publicKey)) continue;

		let keyId: string;
		try {
			keyId = await deviceIdFromPublicKey(subject.publicKey);
		} catch {
			continue;
		}
		// A key-derived ID that is not the hash of the key is not a real one.
		if (isDerivedId(subject.id) && subject.id !== keyId) continue;
		if (ctx.evicted?.has(subject.id) || ctx.evicted?.has(keyId)) continue;
		const existing = byKey.get(keyId);
		const record: PendingIntroduction = existing ?? {
			id: keyId,
			subjectId: subject.id,
			name: subject.name,
			publicKey: subject.publicKey,
			fingerprint: await fingerprintOfKey(subject.publicKey),
			introducedBy: [],
			status: 'pending',
			receivedAt: received
		};
		// Offered again on every connection: nothing to store when this device is already recorded.
		if (record.introducedBy.some((b) => b.id === introducer.id)) continue;
		record.introducedBy.push({ id: introducer.id, name: introducer.name, at: intro.at });
		byKey.set(keyId, record);
		changed.set(keyId, record);
	}
	return [...changed.values()];
}
