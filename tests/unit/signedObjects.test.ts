/*
    Signed bucket objects: who wrote an object is proven by a signature, not by its name; device
    records publish the keys; delta sync skips what is rejected and carries on.
*/
import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/utils/notifier', () => ({ default: { warning: vi.fn() } }));
vi.mock('#lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));

import { CrdtXactStore } from '#lib/storage/crdtXactStore';
import { DeltaSync, deltaKey, snapshotKey, ackKey, type DeltaState } from '#lib/sync/deltaSync';
import { deviceIdFromPublicKey, generateDeviceKey } from '#lib/sync/deviceKey';
import {
	DeviceDirectory,
	publishDeviceRecord,
	readDeviceRecords,
	signDeviceRecord,
	verifyDeviceRecord
} from '#lib/sync/deviceRecords';
import { MemoryRemoteStore, ObjectRejectedError } from '#lib/sync/remoteStore';
import {
	SignedRemoteStore,
	isDerivedId,
	openSigned,
	roleOf,
	sealSigned,
	stripSigned,
	type SigningContext
} from '#lib/sync/signedObjects';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (b: Uint8Array | null | undefined) => (b ? new TextDecoder().decode(b) : null);

interface Identity {
	id: string;
	publicKey: string;
	privateKey: CryptoKey;
}

async function identity(): Promise<Identity> {
	const key = await generateDeviceKey();
	return { ...key, id: await deviceIdFromPublicKey(key.publicKey) };
}

/** What a device sees: its own identity (or none, for a legacy ID) and the keys it knows. */
function context(self: Identity | null, known: Identity[] = []): SigningContext {
	const keys = new Map([...known, ...(self ? [self] : [])].map((d) => [d.id, d.publicKey]));
	return {
		self: self ? { id: self.id, privateKey: self.privateKey } : null,
		publicKeyOf: async (id) => keys.get(id) ?? null
	};
}

const LEGACY_ID = '0b0e2c4a-6f7e-4c2a-9d3a-2f5f0a7a9c11';

describe('ids and object roles', () => {
	it('tells a key-derived ID from a legacy UUID', async () => {
		expect(isDerivedId((await identity()).id)).toBe(true);
		expect(isDerivedId(LEGACY_ID)).toBe(false);
		expect(isDerivedId('dev1')).toBe(false);
	});

	it('knows which objects are signed and by whom', () => {
		expect(roleOf('crdt/xacts/abc.000001.upd')).toEqual({ author: 'abc' });
		expect(roleOf('crdt/scx/abc.ack')).toEqual({ author: 'abc' });
		expect(roleOf('crdt/xacts/snap-01ABC.ydoc')).toBe('snapshot');
		expect(roleOf('manifests/abc.json')).toEqual({ author: 'abc' });
		// Legacy state files, device records, key files and file data are not signed.
		expect(roleOf('crdt/xacts/abc.ydoc')).toBeNull();
		expect(roleOf('devices/abc.json')).toBeNull();
		expect(roleOf('key.json')).toBeNull();
		expect(roleOf('data/files/a.bean')).toBeNull();
	});
});

describe('sealing and opening', () => {
	it('round-trips an object signed by its device', async () => {
		const a = await identity();
		const key = deltaKey('xacts', a.id, 1);
		const stored = await sealSigned(context(a), key, bytes('changes'));
		expect(stored.length).toBeGreaterThan(bytes('changes').length);
		const reader = context(null, [a]);
		expect(text(await openSigned(reader, key, stored))).toBe('changes');
		expect(text(stripSigned(stored))).toBe('changes');
	});

	it('rejects changed content', async () => {
		const a = await identity();
		const key = deltaKey('xacts', a.id, 1);
		const stored = await sealSigned(context(a), key, bytes('changes'));
		stored[stored.length - 1] ^= 1;
		await expect(openSigned(context(null, [a]), key, stored)).rejects.toThrow(ObjectRejectedError);
	});

	it('rejects an object copied to another name', async () => {
		const a = await identity();
		const stored = await sealSigned(context(a), deltaKey('xacts', a.id, 1), bytes('changes'));
		await expect(
			openSigned(context(null, [a]), deltaKey('xacts', a.id, 2), stored)
		).rejects.toThrow(/different device|does not verify/);
	});

	it('rejects an object signed by another device than the one in its name', async () => {
		const a = await identity();
		const b = await identity();
		// B writes a delta under A's name, signing with its own key.
		const forged = await sealSigned(context(b), deltaKey('xacts', b.id, 1), bytes('evil'));
		await expect(
			openSigned(context(null, [a, b]), deltaKey('xacts', a.id, 1), forged)
		).rejects.toThrow(/different device/);
	});

	it('rejects a signature whose key is not known or does not match the ID', async () => {
		const a = await identity();
		const b = await identity();
		const key = deltaKey('xacts', a.id, 1);
		const stored = await sealSigned(context(a), key, bytes('changes'));
		await expect(openSigned(context(null), key, stored)).rejects.toThrow(/not known/);
		// The reader holds B's key under A's ID.
		const swapped: SigningContext = { self: null, publicKeyOf: async () => b.publicKey };
		await expect(openSigned(swapped, key, stored)).rejects.toThrow(/does not match/);
	});

	it('rejects an unsigned object from a key-derived device, but takes one from a legacy ID', async () => {
		const a = await identity();
		const reader = context(await identity());
		await expect(openSigned(reader, deltaKey('xacts', a.id, 1), bytes('plain'))).rejects.toThrow(
			/not signed/
		);
		const legacy = deltaKey('xacts', LEGACY_ID, 1);
		expect(text(await openSigned(reader, legacy, bytes('plain')))).toBe('plain');
	});

	it('takes an unsigned snapshot only while this device has a legacy ID', async () => {
		const snap = snapshotKey('xacts', '01ABC');
		expect(text(await openSigned(context(null), snap, bytes('old')))).toBe('old');
		await expect(openSigned(context(await identity()), snap, bytes('old'))).rejects.toThrow(
			/snapshot is not signed/
		);
	});

	it('signs a snapshot with the compacting device, whoever reads it', async () => {
		const a = await identity();
		const snap = snapshotKey('xacts', '01ABC');
		const stored = await sealSigned(context(a), snap, bytes('state'));
		expect(text(await openSigned(context(await identity(), [a]), snap, stored))).toBe('state');
	});

	it('leaves other objects alone, and signs nothing while this device has a legacy ID', async () => {
		const a = await identity();
		expect(text(await sealSigned(context(a), 'crdt/xacts/x.ydoc', bytes('s')))).toBe('s');
		expect(text(await sealSigned(context(null), deltaKey('xacts', a.id, 1), bytes('s')))).toBe('s');
		expect(text(await openSigned(context(a), 'devices/x.json', bytes('{}')))).toBe('{}');
	});

	it('refuses to sign an object that belongs to another device', async () => {
		const a = await identity();
		const b = await identity();
		await expect(sealSigned(context(a), deltaKey('xacts', b.id, 1), bytes('x'))).rejects.toThrow(
			/another device/
		);
	});
});

describe('device records', () => {
	it('verifies a record of the device it names, and nobody else', async () => {
		const a = await identity();
		const b = await identity();
		const record = await signDeviceRecord(a, { name: 'Phone', publicKey: a.publicKey });
		expect(await verifyDeviceRecord(a.id, record)).toEqual(record);
		expect(await verifyDeviceRecord(b.id, record)).toBeNull();
		expect(await verifyDeviceRecord(a.id, { ...record, name: 'Other' })).toBeNull();
		expect(await verifyDeviceRecord(a.id, { ...record, previousId: LEGACY_ID })).toBeNull();
		// B cannot publish under A's ID: the key in the record must hash to it.
		const forged = await signDeviceRecord(b, { name: 'Phone', publicKey: b.publicKey });
		expect(await verifyDeviceRecord(a.id, forged)).toBeNull();
	});

	it('is published once, republished when something changed, and read back', async () => {
		const a = await identity();
		const remote = new MemoryRemoteStore();
		const info = { name: 'Phone', publicKey: a.publicKey, previousId: LEGACY_ID };
		expect(await publishDeviceRecord(remote, a, info)).toBe(true);
		expect(await publishDeviceRecord(remote, a, info)).toBe(false);
		expect(await publishDeviceRecord(remote, a, { ...info, name: 'Tablet' })).toBe(true);

		const records = await readDeviceRecords(remote);
		expect([...records.keys()]).toEqual([a.id]);
		expect(records.get(a.id)).toMatchObject({ name: 'Tablet', previousId: LEGACY_ID });
	});

	it('is replaced when the stored one was tampered with', async () => {
		const a = await identity();
		const remote = new MemoryRemoteStore();
		const info = { name: 'Phone', publicKey: a.publicKey };
		await publishDeviceRecord(remote, a, info);
		await remote.put(`devices/${a.id}.json`, bytes('garbage'));
		expect((await readDeviceRecords(remote)).size).toBe(0);
		expect(await publishDeviceRecord(remote, a, info)).toBe(true);
		expect((await readDeviceRecords(remote)).size).toBe(1);
	});

	it('gives the directory a key from the trusted list, else from the record in the store', async () => {
		const a = await identity();
		const b = await identity();
		const remote = new MemoryRemoteStore();
		await publishDeviceRecord(remote, a, { name: 'Phone', publicKey: a.publicKey });

		const directory = new DeviceDirectory(new Map([[b.id, b.publicKey]]));
		expect(await directory.publicKeyOf(a.id)).toBeNull(); // Not bound yet.
		directory.bind(remote);
		expect(await directory.publicKeyOf(b.id)).toBe(b.publicKey);
		expect(await directory.publicKeyOf(a.id)).toBe(a.publicKey);
		expect(await directory.publicKeyOf(LEGACY_ID)).toBeNull();
	});
});

describe('SignedRemoteStore', () => {
	it('lets a device read what another wrote, finding its key in the store', async () => {
		const a = await identity();
		const b = await identity();
		const bucket = new MemoryRemoteStore();
		await publishDeviceRecord(bucket, a, { name: 'A', publicKey: a.publicKey });

		const writer = new SignedRemoteStore(bucket, context(a));
		const directory = new DeviceDirectory(new Map());
		directory.bind(bucket);
		const reader = new SignedRemoteStore(bucket, {
			self: { id: b.id, privateKey: b.privateKey },
			publicKeyOf: (id) => directory.publicKeyOf(id)
		});

		const key = deltaKey('xacts', a.id, 1);
		await writer.put(key, bytes('hello'));
		expect(text(await reader.get(key))).toBe('hello');
		expect(text(bucket.objects.get(key)?.body)).not.toBe('hello'); // What is stored is the envelope.
		expect(await reader.get(deltaKey('xacts', a.id, 2))).toBeNull();
	});

	it('refuses an object that a passphrase holder wrote under a trusted name', async () => {
		const a = await identity();
		const mallory = await identity();
		const bucket = new MemoryRemoteStore();
		const key = deltaKey('xacts', a.id, 1);
		// Mallory has the bucket, not A's key: signs as herself, or writes it plain.
		await bucket.put(key, bytes('plain'));
		const reader = new SignedRemoteStore(bucket, context(null, [a]));
		await expect(reader.get(key)).rejects.toBeInstanceOf(ObjectRejectedError);
		const viaMallory = new SignedRemoteStore(bucket, context(mallory));
		await expect(viaMallory.put(key, bytes('evil'))).rejects.toThrow(/another device/);
	});
});

describe('delta sync with signed objects', () => {
	let counter = 0;

	class MemoryStateStorage {
		saved: DeltaState | null = null;
		async load() {
			return this.saved ? structuredClone(this.saved) : null;
		}
		async save(state: DeltaState) {
			this.saved = structuredClone(state);
		}
	}

	const xact = (payee: string) => `2025-01-01 * "${payee}" "Food"
  Expenses:Groceries   10.00 EUR
  Assets:Bank:Checking
`;

	async function device(bucket: MemoryRemoteStore, me: Identity, known: Identity[]) {
		const store = new CrdtXactStore(`test-signed-${++counter}`, async () => me.id);
		await store.initialize();
		const sync = new DeltaSync({
			kind: 'xacts',
			deviceId: me.id,
			doc: store,
			remote: new SignedRemoteStore(bucket, context(me, known)),
			storage: new MemoryStateStorage()
		});
		await sync.attach();
		return { store, sync };
	}

	it('merges signed deltas, and reports a forged one without stopping', async () => {
		const a = await identity();
		const b = await identity();
		const mallory = await identity();
		const bucket = new MemoryRemoteStore();

		const devA = await device(bucket, a, [b, mallory]);
		await devA.store.append(xact('From A'));
		await devA.sync.upload();

		// Mallory plants a delta under B's name; B has not written anything yet.
		await bucket.put(deltaKey('xacts', b.id, 1), bytes('forged'));

		const devB = await device(bucket, b, [a, mallory]);
		const first = await devB.sync.download();
		expect(first.deltas).toBe(1);
		expect(first.errors).toEqual([]); // B skips its own name.

		const devC = await identity();
		const reader = await device(bucket, devC, [a, b]);
		const result = await reader.sync.download();
		expect(result.deltas).toBe(1); // A's delta was applied.
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].key).toBe(deltaKey('xacts', b.id, 1));
		expect(result.errors[0].message).toMatch(/not signed/);
		expect((await reader.store.list()).map((x) => x.xact.payee)).toEqual(['From A']);
	});

	it('skips a forged acknowledgement', async () => {
		const a = await identity();
		const b = await identity();
		const bucket = new MemoryRemoteStore();
		await bucket.put(ackKey('xacts', b.id), bytes('{"snapId":null,"applied":{}}'));
		const devA = await device(bucket, a, [b]);
		await devA.store.append(xact('Only A'));
		await devA.sync.upload();
		// The unsigned acknowledgement is ignored rather than failing the clean-up.
		await expect(
			devA.sync.compactIfDue({ isActive: () => true, force: true })
		).resolves.not.toThrow();
	});
});
