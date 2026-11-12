/*
    Approving or dismissing an introduction on a device (PeerPresence + the database).
*/
import { beforeEach, describe, expect, it } from 'vitest';
import db from '#lib/data/db';
import { PendingIntroduction, TrustedPeer } from '#lib/data/model';
import { deviceIdFromPublicKey, generateDeviceKey } from '#lib/sync/deviceKey';
import { PeerPresence } from '#lib/sync/peerPresence.svelte';

async function pending(name: string, subjectId: string, introducers: string[]) {
	const key = await generateDeviceKey();
	const p = new PendingIntroduction();
	Object.assign(p, {
		id: await deviceIdFromPublicKey(key.publicKey),
		subjectId,
		name,
		publicKey: key.publicKey,
		fingerprint: 'AAAA-BBBB',
		introducedBy: introducers.map((id) => ({ id, name: id, at: 1 })),
		status: 'pending',
		receivedAt: ''
	});
	return p;
}

async function trustA(): Promise<PeerPresence> {
	const a = new TrustedPeer();
	Object.assign(a, { id: 'a-uuid', name: 'Laptop', publicKey: 'a-key', trustedAt: '' });
	await db.peers.put(a);
	const presence = new PeerPresence();
	await presence.reloadTrustedPeers();
	return presence;
}

describe('introduction requests', () => {
	beforeEach(async () => {
		await db.peers.clear();
		await db.introductions.clear();
	});

	it('trusts the device only on approval, records who vouched, and clears the request', async () => {
		const presence = await trustA();
		const intro = await pending('Phone', 'c-uuid', ['gone', 'a-uuid']);
		await db.introductions.put(intro);
		await presence.reloadIntroductions();
		expect(presence.pendingIntroductions).toHaveLength(1);
		expect(await db.peers.get('c-uuid')).toBeUndefined();

		await presence.approveIntroduction(intro.id);

		const trusted = await db.peers.get('c-uuid');
		expect(trusted).toMatchObject({
			name: 'Phone',
			publicKey: intro.publicKey,
			addedBy: 'a-uuid'
		});
		expect(await db.introductions.get(intro.id)).toBeUndefined();
		expect(presence.pendingIntroductions).toEqual([]);
	});

	it('refuses when no introducer is trusted any more, and drops the request', async () => {
		const presence = await trustA();
		const intro = await pending('Phone', 'c-uuid', ['gone']);
		await db.introductions.put(intro);
		await presence.reloadIntroductions();

		await expect(presence.approveIntroduction(intro.id)).rejects.toThrow('no longer trusted');

		expect(await db.peers.get('c-uuid')).toBeUndefined();
		expect(await db.introductions.get(intro.id)).toBeUndefined();
	});

	it('keeps a dismissed request out of the list, and never trusts it', async () => {
		const presence = await trustA();
		const intro = await pending('Phone', 'c-uuid', ['a-uuid']);
		await db.introductions.put(intro);
		await presence.reloadIntroductions();

		await presence.dismissIntroduction(intro.id);
		await presence.approveIntroduction(intro.id);

		expect(presence.pendingIntroductions).toEqual([]);
		expect(await db.introductions.get(intro.id)).toMatchObject({ status: 'dismissed' });
		expect(await db.peers.get('c-uuid')).toBeUndefined();
	});

	it('drops a request when the device is trusted another way, e.g. by invite', async () => {
		const presence = await trustA();
		const intro = await pending('Phone', 'c-uuid', ['a-uuid']);
		await db.introductions.put(intro);

		await presence.trustVerified({ id: 'c-uuid', name: 'Phone', publicKey: intro.publicKey });

		expect(await db.introductions.get(intro.id)).toBeUndefined();
		expect((await db.peers.get('c-uuid'))?.addedBy).toBeUndefined();
	});
});
