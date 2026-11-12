/**
 * Invite links for pairing a device (doc/projects/2026-11-11_device-identity.md, step 3):
 * `https://<app-origin>/pair#<base64url payload>`. The payload sits in the URL fragment, so it
 * never reaches a server. It says whom to expect (`fingerprint`, the inviter's key-derived device
 * ID), where to meet (`strategy`, and a room and signaling password derived from `seed`, so the
 * relay sees neither the seed nor the password) and until when (`exp`). A link is used once: the
 * inviter leaves the room after approving one device.
 */
import {
	fromBase64Url,
	hmacSha256,
	randomBytes,
	toBase64,
	toBase64Url,
	toHex
} from '#lib/sync/encoding';
import { RELAY_STRATEGIES, type RelayStrategy } from '#lib/sync/peerPresence.svelte';

export const INVITE_TTL_MS = 10 * 60 * 1000;
const SEED_BYTES = 16;
const MAX_TOKEN_LENGTH = 2000;
const MAX_NAME_LENGTH = 100;

export interface InvitePayload {
	v: 1;
	/** The inviter's device name, as a label for the joiner's screen. */
	name: string;
	/** The inviter's key-derived device ID: the joiner trusts only a hello whose key hashes to it. */
	fingerprint: string;
	/** The signaling network the inviter is on. */
	strategy: RelayStrategy;
	/** 128 random bits (base64url); the one-use room and its signaling password come from it. */
	seed: string;
	/** Expiry, ms since the epoch. */
	exp: number;
}

export type InviteParseResult =
	| { ok: true; payload: InvitePayload }
	| { ok: false; reason: 'malformed' | 'unsupported' | 'expired' };

export function createInvitePayload(
	input: { name: string; fingerprint: string; strategy: RelayStrategy },
	now: number = Date.now()
): InvitePayload {
	return {
		v: 1,
		name: input.name.slice(0, MAX_NAME_LENGTH),
		fingerprint: input.fingerprint,
		strategy: input.strategy,
		seed: toBase64Url(randomBytes(SEED_BYTES)),
		exp: now + INVITE_TTL_MS
	};
}

export function encodeInvite(payload: InvitePayload): string {
	const { v, name, fingerprint, strategy, seed, exp } = payload;
	return toBase64Url(
		new TextEncoder().encode(JSON.stringify({ v, name, fingerprint, strategy, seed, exp }))
	);
}

export function inviteLink(origin: string, payload: InvitePayload): string {
	return `${origin}/pair#${encodeInvite(payload)}`;
}

/**
 * Reads an invite from a pasted link, a `#fragment` or the bare token. Anything else, a changed
 * field or a link past its expiry is refused.
 */
export function parseInvite(input: string, now: number = Date.now()): InviteParseResult {
	const trimmed = input.trim();
	const token = trimmed.includes('#') ? trimmed.slice(trimmed.lastIndexOf('#') + 1) : trimmed;
	if (!token || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'malformed' };

	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(token)));
	} catch {
		return { ok: false, reason: 'malformed' };
	}
	if (!raw || typeof raw !== 'object') return { ok: false, reason: 'malformed' };
	const p = raw as Record<string, unknown>;
	if (p.v !== 1)
		return { ok: false, reason: typeof p.v === 'number' ? 'unsupported' : 'malformed' };

	const strategies = RELAY_STRATEGIES.map((s) => s.value);
	if (
		typeof p.name !== 'string' ||
		p.name.length > MAX_NAME_LENGTH ||
		typeof p.fingerprint !== 'string' ||
		!/^[0-9a-hjkmnp-tv-z]{26}$/.test(p.fingerprint) ||
		typeof p.strategy !== 'string' ||
		!strategies.includes(p.strategy as RelayStrategy) ||
		typeof p.seed !== 'string' ||
		typeof p.exp !== 'number' ||
		!Number.isFinite(p.exp)
	) {
		return { ok: false, reason: 'malformed' };
	}
	try {
		if (fromBase64Url(p.seed).length !== SEED_BYTES) return { ok: false, reason: 'malformed' };
	} catch {
		return { ok: false, reason: 'malformed' };
	}
	if (p.exp <= now) return { ok: false, reason: 'expired' };

	return {
		ok: true,
		payload: {
			v: 1,
			name: p.name,
			fingerprint: p.fingerprint,
			strategy: p.strategy as RelayStrategy,
			seed: p.seed,
			exp: p.exp
		}
	};
}

/** The one-use room of an invite. Derived, so the relay never sees the seed. */
export async function deriveInviteRoom(seed: string): Promise<string> {
	return 'invite-' + toHex(await hmacSha256(fromBase64Url(seed), 'invite-room-v1')).slice(0, 32);
}

/** The signaling password of an invite's room. */
export async function deriveInvitePassword(seed: string): Promise<string> {
	return toBase64(await hmacSha256(fromBase64Url(seed), 'invite-password-v1'));
}
