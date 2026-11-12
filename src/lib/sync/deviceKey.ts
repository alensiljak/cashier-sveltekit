/**
 * The device's signing key and the signed `hello` of peer sync (see
 * doc/projects/2026-11-11_device-identity.md, steps 1 and 2).
 *
 * The private key is a non-extractable WebCrypto ECDSA P-256 key kept in IndexedDB, so a copy of
 * the site's data does not carry it out as bytes. The public key travels as base64 SPKI.
 */
import db from '#lib/data/db';
import { fromBase64, toBase64 } from '#lib/sync/encoding';

const HELLO_TAG = 'cashier-hello-v1';
const KEY_RECORD_ID = 'device';
const KEY_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' } as const;

export interface DeviceKey {
	privateKey: CryptoKey;
	/** Base64 SPKI of the public key. */
	publicKey: string;
}

/** What a hello signature covers. `signerFp` is the signer's own DTLS fingerprint, `receiverFp` the other end's. */
export interface HelloSignInput {
	id: string;
	name: string;
	signerFp: string;
	receiverFp: string;
}

/**
 * The signed bytes. JSON of an array keeps the fields apart whatever the name contains, and the
 * two fingerprints in signer/receiver order tie the signature to this one connection.
 */
function helloMessage({ id, name, signerFp, receiverFp }: HelloSignInput): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(JSON.stringify([HELLO_TAG, id, name, signerFp, receiverFp]));
}

export async function generateDeviceKey(): Promise<{ privateKey: CryptoKey; publicKey: string }> {
	const pair = await crypto.subtle.generateKey(KEY_ALGORITHM, false, ['sign', 'verify']);
	const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
	return { privateKey: pair.privateKey, publicKey: toBase64(spki) };
}

/** Signs `message` (base64 signature). Every signed record of the app goes through this. */
export async function signMessage(
	privateKey: CryptoKey,
	message: Uint8Array<ArrayBuffer>
): Promise<string> {
	return toBase64(await crypto.subtle.sign(SIGN_ALGORITHM, privateKey, message));
}

/** True when `sig` is the signature of `message` by `publicKey`. Any malformed input is just false. */
export async function verifyMessage(
	publicKey: string,
	sig: string,
	message: Uint8Array<ArrayBuffer>
): Promise<boolean> {
	try {
		const key = await crypto.subtle.importKey('spki', fromBase64(publicKey), KEY_ALGORITHM, false, [
			'verify'
		]);
		return await crypto.subtle.verify(SIGN_ALGORITHM, key, fromBase64(sig), message);
	} catch {
		return false;
	}
}

export function signHello(privateKey: CryptoKey, input: HelloSignInput): Promise<string> {
	return signMessage(privateKey, helloMessage(input));
}

/** True when `sig` is the signature of `input` by `publicKey`. Any malformed input is just false. */
export function verifyHello(
	publicKey: string,
	sig: string,
	input: HelloSignInput
): Promise<boolean> {
	return verifyMessage(publicKey, sig, helloMessage(input));
}

// Crockford's base32 (lowercase): no I, L, O or U, so an ID that is read out or typed is hard to mistake.
const BASE32 = '0123456789abcdefghjkmnpqrstvwxyz';

/** Base32 of the bytes, without padding. */
export function base32(bytes: Uint8Array): string {
	let out = '';
	let bits = 0;
	let acc = 0;
	for (const b of bytes) {
		acc = (acc << 8) | b;
		bits += 8;
		while (bits >= 5) {
			out += BASE32[(acc >>> (bits - 5)) & 31];
			bits -= 5;
		}
		acc &= (1 << bits) - 1;
	}
	if (bits > 0) out += BASE32[(acc << (5 - bits)) & 31];
	return out;
}

/** The ID a key gives its device: the first 16 bytes of SHA-256 of the SPKI, in base32 (26 characters). */
export async function deviceIdFromPublicKey(publicKey: string): Promise<string> {
	const hash = await crypto.subtle.digest('SHA-256', fromBase64(publicKey));
	return base32(new Uint8Array(hash, 0, 16));
}

/** What people see of an ID: its first 8 characters, grouped (`7kq2-m9xa` shows as `7KQ2-M9XA`). */
export function formatFingerprint(deviceId: string): string {
	const head = deviceId.slice(0, 8).toUpperCase();
	return `${head.slice(0, 4)}-${head.slice(4)}`;
}

/** The fingerprint of a public key; never throws (undecodable base64 gives ''). It does not check that the key is valid: use it on keys that verified a signature or were stored after one. */
export async function fingerprintOfKey(publicKey: string): Promise<string> {
	try {
		return formatFingerprint(await deviceIdFromPublicKey(publicKey));
	} catch {
		return '';
	}
}

let loading: Promise<DeviceKey> | null = null;

/** This device's key, created on first use. */
export function getDeviceKey(): Promise<DeviceKey> {
	loading ??= loadOrCreate().catch((e) => {
		loading = null;
		throw e;
	});
	return loading;
}

async function loadOrCreate(): Promise<DeviceKey> {
	const existing = await db.deviceKeys.get(KEY_RECORD_ID);
	if (existing) return { privateKey: existing.privateKey, publicKey: existing.publicKey };

	const fresh = await generateDeviceKey();
	// Another tab may have created a key while this one was generating; the first one stays.
	return db.transaction('rw', db.deviceKeys, async () => {
		const winner = await db.deviceKeys.get(KEY_RECORD_ID);
		if (winner) return { privateKey: winner.privateKey, publicKey: winner.publicKey };
		await db.deviceKeys.put({ id: KEY_RECORD_ID, ...fresh });
		return fresh;
	});
}

/** Forgets the in-memory copy (tests that clear the database). */
export function resetDeviceKeyCache(): void {
	loading = null;
}
