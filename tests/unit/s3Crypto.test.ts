/*
    S3 sync encryption: per-object AES-GCM with a passphrase-derived key.
*/
import { describe, expect, it } from 'vitest';
import {
	createKeyParams,
	decrypt,
	encrypt,
	fromBase64,
	openKey,
	sha256Hex,
	toBase64,
	WrongPassphraseError
} from '$lib/services/s3Crypto';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('encrypt / decrypt', () => {
	it('round-trips', async () => {
		const { key } = await createKeyParams('secret');
		const plain = bytes('2026-01-01 * "Shop"\n');
		const back = await decrypt(key, await encrypt(key, plain));
		// Compared as arrays: WebCrypto returns buffers from another realm than the test's.
		expect(Array.from(back)).toEqual(Array.from(plain));
	});

	it('uses a fresh IV, so equal content encrypts differently', async () => {
		const { key } = await createKeyParams('secret');
		const a = await encrypt(key, bytes('same'));
		const b = await encrypt(key, bytes('same'));
		expect(a).not.toEqual(b);
	});

	it('does not contain the plaintext', async () => {
		const { key } = await createKeyParams('secret');
		const out = new TextDecoder('latin1').decode(await encrypt(key, bytes('Assets:Bank:Checking')));
		expect(out).not.toContain('Checking');
	});

	it('rejects tampered data', async () => {
		const { key } = await createKeyParams('secret');
		const data = await encrypt(key, bytes('hello'));
		data[data.length - 1] ^= 1;
		await expect(decrypt(key, data)).rejects.toThrow();
	});

	it('rejects data that is not an encrypted object', async () => {
		const { key } = await createKeyParams('secret');
		await expect(decrypt(key, bytes('plain text, not encrypted at all'))).rejects.toThrow();
	});
});

describe('passphrase', () => {
	it('opens the same key on another device with the same passphrase', async () => {
		const { params, key } = await createKeyParams('secret');
		const other = await openKey('secret', params);
		const data = await encrypt(key, bytes('shared'));
		expect(new TextDecoder().decode(await decrypt(other, data))).toBe('shared');
	});

	it('rejects a wrong passphrase', async () => {
		const { params } = await createKeyParams('secret');
		await expect(openKey('wrong', params)).rejects.toBeInstanceOf(WrongPassphraseError);
	});

	it('uses a different salt for every bucket', async () => {
		const a = await createKeyParams('secret');
		const b = await createKeyParams('secret');
		expect(a.params.salt).not.toBe(b.params.salt);
	});
});

describe('helpers', () => {
	it('base64 round-trips binary data', () => {
		const data = new Uint8Array([0, 1, 127, 128, 255]);
		expect(fromBase64(toBase64(data))).toEqual(data);
	});

	it('hashes with SHA-256', async () => {
		expect(await sha256Hex(bytes('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});
