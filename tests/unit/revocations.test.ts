/*
    Evicting a device: signed records, who may evict, tombstones, and what they block.
*/
import { beforeEach, describe, expect, it } from 'vitest';
import db from '#lib/data/db';
import { PendingIntroduction, TrustedPeer, type Revocation } from '#lib/data/model';
import { deviceIdFromPublicKey, generateDeviceKey } from '#lib/sync/deviceKey';
import { receiveIntroductions, signIntroduction } from '#lib/sync/introductions';
import { PeerPresence } from '#lib/sync/peerPresence.svelte';
import {
	acceptRevocations,
	applyRevocation,
	clearTombstones,
	evictedIds,
	onRevocationsApplied,
	publishRevocations,
	readBucketRevocations,
	recordsToShare,
	signRevocation,
	syncBucketRevocations
} from '#lib/sync/revocations';
import { MemoryRemoteStore } from '#lib/sync/remoteStore';
import { fileNameOf, keyOfFile } from '#lib/services/webdavRemoteStore';

async function device(name: string) {
	const key = await generateDeviceKey();
	return { key, name, id: await deviceIdFromPublicKey(key.publicKey) };
}
type Dev = Awaited<ReturnType<typeof device>>;

function trusted(d: Dev, extra: Partial<TrustedPeer> = {}): TrustedPeer {
	return Object.assign(new TrustedPeer(), {
		id: d.id,
		name: d.name,
		publicKey: d.key.publicKey,
		fingerprint: 'AAAA-BBBB',
		trustedAt: '',
		...extra
	});
}

const ME = 'me-id';

describe('accepting eviction records', () => {
	it('accepts a record signed by a trusted device and finds the evicted one', async () => {
		const [anna, old] = [await device('Anna'), await device('Old phone')];
		const trust = [trusted(anna), trusted(old)];
		const record = await signRevocation(anna.key, anna.id, old.id);

		const [a] = await acceptRevocations([record], { myId: ME, trusted: trust, tombstones: [] });

		expect(a.record).toEqual(record);
		expect(a.evictor.id).toBe(anna.id);
		expect(a.subject?.id).toBe(old.id);
		expect(a.self).toBe(false);
	});

	it('refuses an untrusted, key-less, read-only or forged evictor', async () => {
		const [anna, old, stranger] = [await device('Anna'), await device('Old'), await device('X')];
		const record = await signRevocation(stranger.key, stranger.id, old.id);
		const ctx = (peers: TrustedPeer[]) => ({ myId: ME, trusted: peers, tombstones: [] });

		expect(await acceptRevocations([record], ctx([trusted(old)]))).toEqual([]);
		expect(
			await acceptRevocations(
				[await signRevocation(anna.key, anna.id, old.id)],
				ctx([trusted(anna, { readOnly: true }), trusted(old)])
			)
		).toEqual([]);
		expect(
			await acceptRevocations(
				[await signRevocation(anna.key, anna.id, old.id)],
				ctx([trusted(anna, { publicKey: undefined }), trusted(old)])
			)
		).toEqual([]);
		// Anna is trusted, but the signature is by another key.
		const forged = { ...(await signRevocation(stranger.key, anna.id, old.id)) };
		expect(await acceptRevocations([forged], ctx([trusted(anna), trusted(old)]))).toEqual([]);
		// Tampered: another device than the one that was signed.
		const tampered = { ...(await signRevocation(anna.key, anna.id, old.id)), revoked: ME };
		expect(await acceptRevocations([tampered], ctx([trusted(anna)]))).toEqual([]);
	});

	it('refuses a device evicting itself, junk, and an oversized message', async () => {
		const anna = await device('Anna');
		const ctx = { myId: ME, trusted: [trusted(anna)], tombstones: [] };
		expect(
			await acceptRevocations([await signRevocation(anna.key, anna.id, anna.id)], ctx)
		).toEqual([]);
		expect(await acceptRevocations('x', ctx)).toEqual([]);
		expect(await acceptRevocations([{ v: 1 }, null, 3], ctx)).toEqual([]);
		const record = await signRevocation(anna.key, anna.id, 'x');
		expect(await acceptRevocations(Array(101).fill(record), ctx)).toEqual([]);
	});

	it('flags a record that evicts this device', async () => {
		const anna = await device('Anna');
		const record = await signRevocation(anna.key, anna.id, ME);
		const [a] = await acceptRevocations([record], {
			myId: ME,
			trusted: [trusted(anna)],
			tombstones: []
		});
		expect(a.self).toBe(true);
		expect(a.subject).toBeNull();
	});

	it('knows the evicted device by a legacy ID', async () => {
		const [anna, old] = [await device('Anna'), await device('Old')];
		const trust = [trusted(anna), trusted(old, { legacyIds: ['old-uuid'] })];
		const record = await signRevocation(anna.key, anna.id, 'old-uuid');
		const [a] = await acceptRevocations([record], { myId: ME, trusted: trust, tombstones: [] });
		expect(a.subject?.id).toBe(old.id);
	});
});

describe('tombstones', () => {
	beforeEach(async () => {
		await db.peers.clear();
		await db.revocations.clear();
		await db.introductions.clear();
		await db.peerSyncBaseline.clear();
	});

	it('removes the trusted record, its baselines and its requests, and keeps a tombstone', async () => {
		const [anna, old] = [await device('Anna'), await device('Old phone')];
		await db.peers.bulkPut([trusted(anna), trusted(old, { legacyIds: ['old-uuid'] })]);
		await db.peerSyncBaseline.put({
			endpointId: old.id,
			path: 'a.bean',
			localHash: 'x',
			remoteHash: 'y',
			syncedAt: ''
		});
		await db.introductions.put(
			Object.assign(new PendingIntroduction(), { id: old.id, subjectId: 'old-uuid' })
		);
		const record = await signRevocation(anna.key, anna.id, old.id);
		const [a] = await acceptRevocations([record], {
			myId: ME,
			trusted: await db.peers.toArray(),
			tombstones: []
		});

		const rows = await applyRevocation(a);

		expect(rows.map((r) => r.id).sort()).toEqual([old.id, 'old-uuid'].sort());
		expect(await db.peers.get(old.id)).toBeUndefined();
		expect(await db.peers.get(anna.id)).toBeDefined();
		expect(await db.peerSyncBaseline.count()).toBe(0);
		expect(await db.introductions.count()).toBe(0);
		const stored: Revocation = await db.revocations.get(old.id);
		expect(stored).toMatchObject({ status: 'evicted', name: 'Old phone', byName: 'Anna' });
	});

	it('ignores a record for a device that is already evicted', async () => {
		const [anna, bob, old] = [await device('Anna'), await device('Bob'), await device('Old')];
		await db.peers.bulkPut([trusted(anna), trusted(bob), trusted(old)]);
		const first = await signRevocation(anna.key, anna.id, old.id);
		const ctx = async () => ({
			myId: ME,
			trusted: await db.peers.toArray(),
			tombstones: await db.revocations.toArray()
		});
		await applyRevocation((await acceptRevocations([first], await ctx()))[0]);

		const again = await signRevocation(bob.key, bob.id, old.id);
		expect(await acceptRevocations([again], await ctx())).toEqual([]);
	});

	it('shares each active record once, and not a cleared one', async () => {
		const [anna, old] = [await device('Anna'), await device('Old')];
		await db.peers.bulkPut([trusted(anna), trusted(old, { legacyIds: ['old-uuid'] })]);
		const record = await signRevocation(anna.key, anna.id, old.id);
		await applyRevocation(
			(
				await acceptRevocations([record], {
					myId: ME,
					trusted: await db.peers.toArray(),
					tombstones: []
				})
			)[0]
		);
		expect(recordsToShare(await db.revocations.toArray())).toEqual([record]);

		await clearTombstones([old.id, 'old-uuid']);
		expect(recordsToShare(await db.revocations.toArray())).toEqual([]);
		expect(evictedIds(await db.revocations.toArray()).size).toBe(0);
	});

	it('ignores an old record after the device was paired with again, and takes a newer one', async () => {
		const [anna, old] = [await device('Anna'), await device('Old')];
		await db.peers.bulkPut([trusted(anna), trusted(old)]);
		const oldRecord = await signRevocation(anna.key, anna.id, old.id, 1000);
		await applyRevocation(
			(
				await acceptRevocations([oldRecord], {
					myId: ME,
					trusted: await db.peers.toArray(),
					tombstones: []
				})
			)[0]
		);
		await clearTombstones([old.id], new Date(5000));
		await db.peers.put(trusted(old));
		const ctx = async () => ({
			myId: ME,
			trusted: await db.peers.toArray(),
			tombstones: await db.revocations.toArray()
		});

		// Gossiped back by a device that has not paired again.
		expect(await acceptRevocations([oldRecord], await ctx())).toEqual([]);
		const newer = await signRevocation(anna.key, anna.id, old.id, 9000);
		expect(await acceptRevocations([newer], await ctx())).toHaveLength(1);
	});
});

describe('what an eviction blocks on a device', () => {
	beforeEach(async () => {
		await db.peers.clear();
		await db.revocations.clear();
		await db.introductions.clear();
	});

	async function evictedSetup() {
		const [anna, old] = [await device('Anna'), await device('Old phone')];
		await db.peers.bulkPut([trusted(anna), trusted(old)]);
		const presence = new PeerPresence();
		presence.myId = ME;
		await presence.reloadTrustedPeers();
		// Anna evicts: the record arrives as gossip.
		const record = await signRevocation(anna.key, anna.id, old.id);
		const [a] = await acceptRevocations([record], {
			myId: ME,
			trusted: presence.trustedPeers,
			tombstones: []
		});
		await applyRevocation(a);
		await presence.reloadTrustedPeers();
		await presence.reloadRevocations();
		return { presence, anna, old };
	}

	it('refuses to trust the device, unless a person pairs with it again', async () => {
		const { presence, old } = await evictedSetup();
		expect(presence.evicted.has(old.id)).toBe(true);
		expect(presence.unseenEvictions).toHaveLength(1);

		await expect(
			presence.trustVerified({ id: old.id, name: 'Old phone', publicKey: old.key.publicKey })
		).rejects.toThrow('evicted');
		expect(await db.peers.get(old.id)).toBeUndefined();

		await presence.trustVerified({
			id: old.id,
			name: 'Old phone',
			publicKey: old.key.publicKey,
			readmit: true
		});
		expect(await db.peers.get(old.id)).toBeDefined();
		expect(presence.evicted.has(old.id)).toBe(false);
	});

	it('refuses an introduction of an evicted device, and a request that was queued before', async () => {
		const { presence, anna, old } = await evictedSetup();
		const me = await device('Me');
		const intro = await signIntroduction(anna.key, anna.id, {
			id: old.id,
			name: 'Old phone',
			publicKey: old.key.publicKey
		});
		const fresh = await receiveIntroductions([intro], {
			me: { id: me.id, publicKey: me.key.publicKey },
			introducer: presence.trustedPeers.find((p) => p.id === anna.id)!,
			trusted: presence.trustedPeers,
			pending: [],
			evicted: presence.evicted
		});
		expect(fresh).toEqual([]);

		// A request that slipped in (stored by an older build) is dropped on approval.
		await db.introductions.put(
			Object.assign(new PendingIntroduction(), {
				id: old.id,
				subjectId: old.id,
				name: 'Old phone',
				publicKey: old.key.publicKey,
				introducedBy: [{ id: anna.id, name: 'Anna', at: 1 }],
				status: 'pending'
			})
		);
		await presence.reloadIntroductions();
		await expect(presence.approveIntroduction(old.id)).rejects.toThrow('evicted');
		expect(await db.introductions.get(old.id)).toBeUndefined();
	});

	it('evicts a trusted device on this device and signs the record', async () => {
		const [anna, old] = [await device('Anna'), await device('Old phone')];
		await db.peers.bulkPut([trusted(anna), trusted(old)]);
		const presence = new PeerPresence();
		await presence.init();
		const me = presence.myId;

		const record = await presence.evictPeer(old.id);

		expect(record).toMatchObject({ revoked: old.id, by: me });
		expect(await db.peers.get(old.id)).toBeUndefined();
		expect(presence.evicted.has(old.id)).toBe(true);
		await expect(presence.evictPeer(me)).rejects.toThrow();
		await expect(presence.evictPeer('nobody')).rejects.toThrow('not trusted');
	});
});

describe('eviction records in a bucket or folder', () => {
	beforeEach(async () => {
		await db.peers.clear();
		await db.revocations.clear();
		await db.introductions.clear();
	});

	it('publishes active records once and reads them back', async () => {
		const [anna, old] = [await device('Anna'), await device('Old')];
		const remote = new MemoryRemoteStore();
		const record = await signRevocation(anna.key, anna.id, old.id);

		expect(await publishRevocations(remote, [record])).toBe(1);
		expect(await publishRevocations(remote, [record])).toBe(0);
		expect([...remote.objects.keys()]).toEqual([`revocations/${old.id}.json`]);
		expect(await readBucketRevocations(remote)).toEqual([record]);
	});

	it('evicts on a record found in the store, publishes what it knows, and tells listeners', async () => {
		const [anna, bob, old] = [await device('Anna'), await device('Bob'), await device('Old')];
		await db.peers.bulkPut([trusted(anna), trusted(bob), trusted(old)]);
		const remote = new MemoryRemoteStore();
		await publishRevocations(remote, [await signRevocation(anna.key, anna.id, old.id)]);
		let told = 0;
		const stop = onRevocationsApplied(() => told++);

		const applied = await syncBucketRevocations('store-a', remote, ME);
		stop();

		expect(applied.map((a) => a.record.revoked)).toEqual([old.id]);
		expect(await db.peers.get(old.id)).toBeUndefined();
		expect(await db.peers.get(bob.id)).toBeDefined();
		expect(told).toBe(1);

		// What this device learned elsewhere is written to a store that lacks it.
		const other = new MemoryRemoteStore();
		await syncBucketRevocations('store-b', other, ME);
		expect([...other.objects.keys()]).toEqual([`revocations/${old.id}.json`]);
	});

	it('ignores a record in the store from a device that is not trusted', async () => {
		const [anna, stranger, old] = [await device('Anna'), await device('X'), await device('Old')];
		await db.peers.bulkPut([trusted(anna), trusted(old)]);
		const remote = new MemoryRemoteStore();
		await publishRevocations(remote, [await signRevocation(stranger.key, stranger.id, old.id)]);

		expect(await syncBucketRevocations('store-c', remote, ME)).toEqual([]);
		expect(await db.peers.get(old.id)).toBeDefined();
	});

	it('maps the records to WebDAV file names and back', () => {
		expect(fileNameOf('revocations/abc.json')).toBe('cashier-revocation-abc.json');
		expect(keyOfFile('cashier-revocation-abc.json')).toBe('revocations/abc.json');
	});
});
