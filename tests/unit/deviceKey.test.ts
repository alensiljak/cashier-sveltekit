/*
    Device signing key and the signed hello of peer sync.
*/
import { beforeEach, describe, expect, it } from 'vitest';
import db from '#lib/data/db';
import { TrustedPeer } from '#lib/data/model';
import {
	generateDeviceKey,
	getDeviceKey,
	resetDeviceKeyCache,
	signHello,
	verifyHello,
	type HelloSignInput
} from '#lib/sync/deviceKey';
import { assessHello, type HelloMessage } from '#lib/sync/peerPresence.svelte';

const A_FP = 'AA:AA:AA';
const B_FP = 'BB:BB:BB';

/** A hello as device A sends it over a connection where A's fingerprint is A_FP and B's is B_FP. */
async function helloFromA(over: Partial<HelloSignInput> = {}) {
	const key = await generateDeviceKey();
	const input: HelloSignInput = {
		id: 'dev-a',
		name: 'Phone',
		signerFp: A_FP,
		receiverFp: B_FP,
		...over
	};
	const sig = await signHello(key.privateKey, input);
	return { key, input, sig };
}

function trusted(id: string, publicKey?: string): TrustedPeer {
	const tp = new TrustedPeer();
	tp.id = id;
	tp.publicKey = publicKey;
	return tp;
}

describe('verifyHello', () => {
	it('accepts a valid signature', async () => {
		const { key, input, sig } = await helloFromA();

		expect(await verifyHello(key.publicKey, sig, input)).toBe(true);
	});

	it('rejects a hello replayed on another connection (different fingerprints)', async () => {
		const { key, input, sig } = await helloFromA();

		expect(await verifyHello(key.publicKey, sig, { ...input, receiverFp: 'CC:CC:CC' })).toBe(false);
		expect(await verifyHello(key.publicKey, sig, { ...input, signerFp: 'CC:CC:CC' })).toBe(false);
	});

	it('rejects the fingerprints in the wrong order', async () => {
		const { key, input, sig } = await helloFromA();

		expect(
			await verifyHello(key.publicKey, sig, { ...input, signerFp: B_FP, receiverFp: A_FP })
		).toBe(false);
	});

	it('rejects a signature made by another key', async () => {
		const { input, sig } = await helloFromA();
		const other = await generateDeviceKey();

		expect(await verifyHello(other.publicKey, sig, input)).toBe(false);
	});

	it('rejects a changed name or ID', async () => {
		const { key, input, sig } = await helloFromA();

		expect(await verifyHello(key.publicKey, sig, { ...input, name: 'Tablet' })).toBe(false);
		expect(await verifyHello(key.publicKey, sig, { ...input, id: 'dev-x' })).toBe(false);
	});

	it('keeps the fields apart whatever the name contains', async () => {
		const { key, input, sig } = await helloFromA({ name: 'Phone","AA:AA:AA' });

		expect(await verifyHello(key.publicKey, sig, { ...input, name: 'Phone' })).toBe(false);
	});

	it('treats malformed keys and signatures as invalid', async () => {
		const { key, input, sig } = await helloFromA();

		expect(await verifyHello('not base64!', sig, input)).toBe(false);
		expect(await verifyHello(key.publicKey, '###', input)).toBe(false);
		expect(await verifyHello('', '', input)).toBe(false);
	});
});

describe('assessHello', () => {
	// B receives: its own fingerprint is local, A's is remote.
	const fps = { local: B_FP, remote: A_FP };

	async function message(over: Partial<HelloMessage> = {}) {
		const { key, sig } = await helloFromA();
		const msg: HelloMessage = {
			id: 'dev-a',
			name: 'Phone',
			publicKey: key.publicKey,
			sig,
			...over
		};
		return { key, msg };
	}

	it('trusts a verified peer whose trusted record holds the same key', async () => {
		const { key, msg } = await message();

		const result = await assessHello(msg, fps, [trusted('dev-a', key.publicKey)]);

		expect(result).toMatchObject({ isTrusted: true, verified: true, publicKey: key.publicKey });
		expect(result.trustIssue).toBeUndefined();
	});

	it('does not trust a copied ID with another key', async () => {
		const real = await generateDeviceKey();
		const { msg } = await message();

		const result = await assessHello(msg, fps, [trusted('dev-a', real.publicKey)]);

		expect(result).toMatchObject({ isTrusted: false, verified: true, trustIssue: 'key-mismatch' });
	});

	it('does not trust a copied ID that sends no key at all (legacy hello)', async () => {
		const real = await generateDeviceKey();

		const result = await assessHello({ id: 'dev-a', name: 'Phone' }, fps, [
			trusted('dev-a', real.publicKey)
		]);

		expect(result).toEqual({ isTrusted: false, verified: false });
	});

	it('does not trust a hello replayed from another connection', async () => {
		const { key, msg } = await message();

		const result = await assessHello(msg, { local: B_FP, remote: 'CC:CC:CC' }, [
			trusted('dev-a', key.publicKey)
		]);

		expect(result.isTrusted).toBe(false);
		expect(result.verified).toBe(false);
	});

	it('does not trust when the connection fingerprints are unreadable', async () => {
		const { key, msg } = await message();

		const result = await assessHello(msg, null, [trusted('dev-a', key.publicKey)]);

		expect(result).toEqual({ isTrusted: false, verified: false });
	});

	it('asks to pair again when the trusted record has no key yet', async () => {
		const { msg } = await message();

		const result = await assessHello(msg, fps, [trusted('dev-a')]);

		expect(result).toMatchObject({ isTrusted: false, verified: true, trustIssue: 'legacy-record' });
	});

	it('does not trust an unknown but verified peer (it can only be paired)', async () => {
		const { msg } = await message();

		const result = await assessHello(msg, fps, []);

		expect(result).toMatchObject({ isTrusted: false, verified: true });
		expect(result.trustIssue).toBeUndefined();
	});
});

describe('getDeviceKey', () => {
	beforeEach(async () => {
		await db.deviceKeys.clear();
		resetDeviceKeyCache();
	});

	it('is created once, kept, and can sign', async () => {
		const first = await getDeviceKey();
		resetDeviceKeyCache();
		const again = await getDeviceKey();

		expect(again.publicKey).toBe(first.publicKey);
		const input = { id: 'x', name: 'n', signerFp: A_FP, receiverFp: B_FP };
		expect(
			await verifyHello(again.publicKey, await signHello(again.privateKey, input), input)
		).toBe(true);
	});

	it('never exposes the private key as bytes', async () => {
		const { privateKey } = await getDeviceKey();

		expect(privateKey.extractable).toBe(false);
		await expect(crypto.subtle.exportKey('pkcs8', privateKey)).rejects.toThrow();
	});

	it('gives concurrent callers the same key', async () => {
		const [a, b] = await Promise.all([getDeviceKey(), getDeviceKey()]);

		expect(a.publicKey).toBe(b.publicKey);
		expect(await db.deviceKeys.count()).toBe(1);
	});
});
