/*
    Devices as an S3 bucket or WebDAV folder shows them: when each was last seen, what its device
    record says, and how a device that switched to a key-derived ID is recognised there.
*/
import { beforeEach, describe, expect, it } from 'vitest';
import db from '#lib/data/db';
import { TrustedPeer } from '#lib/data/model';
import { deviceIdFromPublicKey, generateDeviceKey } from '#lib/sync/deviceKey';
import {
	adoptSwitchedDevices,
	bucketDeviceInfo,
	publishDeviceRecord,
	readDeviceRecords
} from '#lib/sync/deviceRecords';
import { noteBucketActivity } from '#lib/sync/lastSeen';
import { MemoryRemoteStore } from '#lib/sync/remoteStore';
import { trustDevice } from '#lib/sync/ydocDevices';

const UUID = '0b0e2c4a-6f7e-4c2a-9d3a-2f5f0a7a9c11';

async function identity() {
	const key = await generateDeviceKey();
	return { ...key, id: await deviceIdFromPublicKey(key.publicKey) };
}

function record(id: string, over: Partial<TrustedPeer> = {}): TrustedPeer {
	return Object.assign(new TrustedPeer(), { id, name: 'Phone', trustedAt: 'then' }, over);
}

beforeEach(async () => {
	await db.peers.clear();
	await db.peerSyncBaseline.clear();
});

describe('noteBucketActivity', () => {
	it('moves lastSeen forward to the newest object a trusted device wrote, and never back', async () => {
		await db.peers.put(record('a', { lastSeen: '2026-01-01T00:00:00.000Z' }));
		await db.peers.put(record('b', { lastSeen: '2026-06-01T00:00:00.000Z' }));
		await db.peers.put(record('c'));

		const changed = await noteBucketActivity([
			{ deviceId: 'a', lastModified: new Date('2026-03-01T00:00:00Z') },
			{ deviceId: 'a', lastModified: new Date('2026-02-01T00:00:00Z') },
			{ deviceId: 'b', lastModified: new Date('2026-03-01T00:00:00Z') }, // Older than what is known.
			{ deviceId: 'stranger', lastModified: new Date('2026-09-01T00:00:00Z') },
			{ deviceId: null, lastModified: new Date('2026-09-01T00:00:00Z') }, // A snapshot.
			{ deviceId: 'c', lastModified: null }
		]);

		expect(changed).toBe(1);
		expect((await db.peers.get('a'))?.lastSeen).toBe('2026-03-01T00:00:00.000Z');
		expect((await db.peers.get('b'))?.lastSeen).toBe('2026-06-01T00:00:00.000Z');
		expect((await db.peers.get('c'))?.lastSeen).toBeUndefined();
		expect(await db.peers.get('stranger')).toBeUndefined();
	});

	it('counts what a device wrote under a legacy ID', async () => {
		await db.peers.put(
			record('newid', { legacyIds: [UUID], lastSeen: '2026-01-01T00:00:00.000Z' })
		);
		await noteBucketActivity([{ deviceId: UUID, lastModified: new Date('2026-04-01T00:00:00Z') }]);
		expect((await db.peers.get('newid'))?.lastSeen).toBe('2026-04-01T00:00:00.000Z');
	});
});

describe('bucketDeviceInfo', () => {
	it('is empty for a device without a record', async () => {
		expect(await bucketDeviceInfo('x', undefined, [])).toEqual({});
	});

	it('gives the name, key and fingerprint a device announces', async () => {
		const a = await identity();
		const bucket = new MemoryRemoteStore();
		await publishDeviceRecord(bucket, a, { name: 'Phone', publicKey: a.publicKey });
		const rec = (await readDeviceRecords(bucket)).get(a.id);

		const info = await bucketDeviceInfo(a.id, rec, []);
		expect(info).toMatchObject({ announcedName: 'Phone', publicKey: a.publicKey });
		expect(info.fingerprint).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
		expect(info.replaces).toBeUndefined();
	});

	it('says which trusted record trusting it would replace', async () => {
		const a = await identity();
		const bucket = new MemoryRemoteStore();
		await publishDeviceRecord(bucket, a, {
			name: 'Phone',
			publicKey: a.publicKey,
			previousId: UUID
		});
		const rec = (await readDeviceRecords(bucket)).get(a.id);

		expect(
			(await bucketDeviceInfo(a.id, rec, [record(UUID, { name: "Anna's phone" })])).replaces
		).toEqual({ id: UUID, name: "Anna's phone", kind: 'approve' });
		expect(
			(await bucketDeviceInfo(a.id, rec, [record(UUID, { publicKey: a.publicKey })])).replaces?.kind
		).toBe('rekey');
		expect((await bucketDeviceInfo(a.id, rec, [])).replaces).toBeUndefined();
	});
});

describe('adoptSwitchedDevices', () => {
	it('re-keys a record whose key matches a device record, and leaves a key-less one for a person', async () => {
		const withKey = await identity();
		const keyless = await identity();
		const bucket = new MemoryRemoteStore();
		await publishDeviceRecord(bucket, withKey, {
			name: 'Tablet',
			publicKey: withKey.publicKey,
			previousId: 'old-1'
		});
		await publishDeviceRecord(bucket, keyless, {
			name: 'Laptop',
			publicKey: keyless.publicKey,
			previousId: 'old-2'
		});
		await db.peers.put(record('old-1', { name: 'My tablet', publicKey: withKey.publicKey }));
		await db.peers.put(record('old-2', { name: 'My laptop' }));

		expect(await adoptSwitchedDevices(bucket)).toBe(1);

		const ids = (await db.peers.toArray()).map((p) => p.id).sort();
		expect(ids).toEqual([withKey.id, 'old-2'].sort());
		expect(await db.peers.get(withKey.id)).toMatchObject({
			name: 'My tablet',
			legacyIds: ['old-1']
		});
		expect(await adoptSwitchedDevices(bucket)).toBe(0); // Nothing left to do.
	});
});

describe('trustDevice with a device record', () => {
	it('replaces the key-less record the device names, keeping its label', async () => {
		const a = await identity();
		await db.peers.put(record(UUID, { name: "Anna's phone", readOnly: true }));

		const tp = await trustDevice(a.id, '', a.publicKey, UUID);

		expect(tp).toMatchObject({
			id: a.id,
			name: "Anna's phone",
			readOnly: true,
			legacyIds: [UUID],
			publicKey: a.publicKey
		});
		expect((await db.peers.toArray()).map((p) => p.id)).toEqual([a.id]);
	});

	it('adds a new device with its key when it replaces nothing', async () => {
		const a = await identity();
		const tp = await trustDevice(a.id, 'Tablet', a.publicKey);
		expect(tp).toMatchObject({ id: a.id, name: 'Tablet', publicKey: a.publicKey });
		expect(await db.peers.count()).toBe(1);
	});
});
