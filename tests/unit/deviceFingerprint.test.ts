/*
    Key-derived device ID and fingerprint, and the local names of trusted peers.
*/
import { beforeEach, describe, expect, it } from 'vitest';
import db from '#lib/data/db';
import { TrustedPeer } from '#lib/data/model';
import {
	base32,
	deviceIdFromPublicKey,
	fingerprintOfKey,
	formatFingerprint,
	generateDeviceKey,
	signHello
} from '#lib/sync/deviceKey';
import { assessHello, PeerPresence } from '#lib/sync/peerPresence.svelte';

describe('base32', () => {
	it('encodes with the Crockford alphabet, without padding', () => {
		expect(base32(new Uint8Array(16))).toBe('0'.repeat(26));
		expect(base32(new Uint8Array(16).fill(0xff))).toBe('z'.repeat(25) + 'w');
		expect(base32(new Uint8Array([0x00, 0x01]))).toBe('000g');
		expect(base32(new Uint8Array(0))).toBe('');
	});
});

describe('deviceIdFromPublicKey', () => {
	it('is 26 characters from the alphabet, safe in S3 keys and file names', async () => {
		const { publicKey } = await generateDeviceKey();

		expect(await deviceIdFromPublicKey(publicKey)).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
	});

	it('is the same for the same key and differs between keys', async () => {
		const a = await generateDeviceKey();
		const b = await generateDeviceKey();

		expect(await deviceIdFromPublicKey(a.publicKey)).toBe(await deviceIdFromPublicKey(a.publicKey));
		expect(await deviceIdFromPublicKey(a.publicKey)).not.toBe(
			await deviceIdFromPublicKey(b.publicKey)
		);
	});
});

describe('formatFingerprint', () => {
	it('shows the first 8 characters of the ID, upper case, in two groups', () => {
		expect(formatFingerprint('7kq2m9xa4bc0de1fgh2jk3mnp4')).toBe('7KQ2-M9XA');
	});

	it('is what the key gives, and empty for a malformed key', async () => {
		const { publicKey } = await generateDeviceKey();

		expect(await fingerprintOfKey(publicKey)).toBe(
			formatFingerprint(await deviceIdFromPublicKey(publicKey))
		);
		expect(await fingerprintOfKey('###')).toBe('');
	});
});

describe('assessHello fingerprint', () => {
	it('carries the fingerprint of a verified peer only', async () => {
		const key = await generateDeviceKey();
		const sig = await signHello(key.privateKey, {
			id: 'dev-a',
			name: 'Phone',
			signerFp: 'AA:AA',
			receiverFp: 'BB:BB'
		});
		const fps = { local: 'BB:BB', remote: 'AA:AA' };

		const ok = await assessHello(
			{ id: 'dev-a', name: 'Phone', publicKey: key.publicKey, sig },
			fps,
			[]
		);
		const bad = await assessHello(
			{ id: 'dev-a', name: 'Tablet', publicKey: key.publicKey, sig },
			fps,
			[]
		);

		expect(ok.fingerprint).toBe(await fingerprintOfKey(key.publicKey));
		expect(bad.fingerprint).toBeUndefined();
	});
});

describe('peer names', () => {
	beforeEach(async () => {
		await db.peers.clear();
	});

	async function trusted(over: Partial<TrustedPeer> = {}) {
		const tp = new TrustedPeer();
		Object.assign(tp, { id: 'dev-a', name: 'Phone', announcedName: 'Phone', ...over });
		await db.peers.put(tp);
	}

	it('renames a peer locally and keeps the name it announced', async () => {
		await trusted();
		const presence = new PeerPresence();

		await presence.renamePeer('dev-a', "  Anna's phone ");

		const tp = await db.peers.get('dev-a');
		expect(tp.name).toBe("Anna's phone");
		expect(tp.announcedName).toBe('Phone');
		expect(presence.trustedPeers[0].name).toBe("Anna's phone");
	});

	it('goes back to the announced name when the label is emptied', async () => {
		await trusted({ name: "Anna's phone" });
		const presence = new PeerPresence();

		await presence.renamePeer('dev-a', '   ');

		expect((await db.peers.get('dev-a')).name).toBe('Phone');
	});

	it('ignores an unknown peer', async () => {
		const presence = new PeerPresence();

		await presence.renamePeer('nobody', 'X');

		expect(await db.peers.count()).toBe(0);
	});

	it('gives records paired earlier a fingerprint when the list is loaded', async () => {
		const { publicKey } = await generateDeviceKey();
		await trusted({ publicKey });
		const presence = new PeerPresence();

		await presence.reloadTrustedPeers();

		const expected = await fingerprintOfKey(publicKey);
		expect(presence.trustedPeers[0].fingerprint).toBe(expected);
		expect((await db.peers.get('dev-a')).fingerprint).toBe(expected);
	});

	it('leaves a record without a key without a fingerprint', async () => {
		await trusted();
		const presence = new PeerPresence();

		await presence.reloadTrustedPeers();

		expect(presence.trustedPeers[0].fingerprint).toBeUndefined();
	});
});
