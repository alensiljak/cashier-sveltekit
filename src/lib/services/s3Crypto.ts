/**
 * Encryption for S3 sync. Every object is encrypted on its own with AES-256-GCM, using a key
 * derived from the user's passphrase (PBKDF2-SHA256). Each object gets a fresh random IV.
 *
 * Object layout: [1 byte format version][12 bytes IV][ciphertext + GCM tag].
 *
 * The salt and iteration count are not secret. They are kept in `key.json` in the bucket, so
 * every device derives the same key from the same passphrase.
 */

const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const SALT_BYTES = 16;
export const PBKDF2_ITERATIONS = 250_000;
/** Known plaintext, encrypted into key.json to tell a wrong passphrase from corrupt data. */
const CHECK_TEXT = 'cashier-s3-sync';

export interface KeyParams {
	version: number;
	/** base64 */
	salt: string;
	iterations: number;
	/** base64 of the encrypted CHECK_TEXT. */
	check: string;
}

export class WrongPassphraseError extends Error {
	constructor() {
		super('Wrong passphrase for this bucket.');
		this.name = 'WrongPassphraseError';
	}
}

export function toBase64(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
	const s = atob(text);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

export async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deriveKey(
	passphrase: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number
): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(passphrase),
		'PBKDF2',
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export async function encrypt(
	key: CryptoKey,
	plain: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
	const out = new Uint8Array(1 + IV_BYTES + cipher.length);
	out[0] = FORMAT_VERSION;
	out.set(iv, 1);
	out.set(cipher, 1 + IV_BYTES);
	return out;
}

/** Throws if the data is malformed, tampered with, or encrypted with another key. */
export async function decrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
	if (data.length < 1 + IV_BYTES + 16 || data[0] !== FORMAT_VERSION) {
		throw new Error('Not an encrypted Cashier object, or an unsupported version.');
	}
	const iv = data.slice(1, 1 + IV_BYTES);
	const cipher = data.slice(1 + IV_BYTES);
	return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
}

/** New key parameters for a bucket that has none yet. */
export async function createKeyParams(
	passphrase: string
): Promise<{ params: KeyParams; key: CryptoKey }> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
	const check = await encrypt(key, new TextEncoder().encode(CHECK_TEXT));
	return {
		params: {
			version: FORMAT_VERSION,
			salt: toBase64(salt),
			iterations: PBKDF2_ITERATIONS,
			check: toBase64(check)
		},
		key
	};
}

/** Derives the key from the bucket's parameters and verifies the passphrase against them. */
export async function openKey(passphrase: string, params: KeyParams): Promise<CryptoKey> {
	if (params.version !== FORMAT_VERSION) throw new Error('Unsupported encryption version.');
	const key = await deriveKey(passphrase, fromBase64(params.salt), params.iterations);
	try {
		const plain = await decrypt(key, fromBase64(params.check));
		if (new TextDecoder().decode(plain) !== CHECK_TEXT) throw new WrongPassphraseError();
	} catch (e) {
		if (e instanceof WrongPassphraseError) throw e;
		throw new WrongPassphraseError();
	}
	return key;
}
