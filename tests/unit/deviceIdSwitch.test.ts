/*
    The switch from a legacy UUID to the key-derived device ID: when it happens, and that no data is
    lost when a device moves on in a shared bucket (sync, switch, delta numbers restart, retire).
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/utils/notifier', () => ({ default: { warning: vi.fn() } }));
vi.mock('#lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));

const mocks = vi.hoisted(() => ({ remotes: [] as string[], unsent: false, resets: 0 }));
vi.mock('#lib/sync/deltaSyncRegistry', () => ({
	configuredRemoteIds: async () => mocks.remotes,
	getDeltaSync: async () => ({ hasUpload: async () => mocks.unsent }),
	notConnected: {},
	resetDeltaSyncRegistry: () => void mocks.resets++
}));
vi.mock('#lib/storage/xactStoreRegistry', () => ({ getXactStore: async () => ({}) }));
vi.mock('#lib/storage/scxStoreRegistry', () => ({
	getScxStore: async () => ({ isInitialized: async () => false })
}));

import db from '#lib/data/db';
import { CrdtXactStore } from '#lib/storage/crdtXactStore';
import { DeltaSync, deltaKey, snapshotKey, type DeltaState } from '#lib/sync/deltaSync';
import { switchDeviceIdIfReady } from '#lib/sync/deviceIdSwitch';
import {
	deviceIdFromPublicKey,
	generateDeviceKey,
	getDeviceKey,
	resetDeviceKeyCache
} from '#lib/sync/deviceKey';
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { MemoryRemoteStore } from '#lib/sync/remoteStore';
import { SignedRemoteStore, type SigningContext } from '#lib/sync/signedObjects';
import { getDeviceId } from '#lib/sync/ydocDevices';

const UUID = '0b0e2c4a-6f7e-4c2a-9d3a-2f5f0a7a9c11';

beforeEach(async () => {
	await db.deviceSettings.clear();
	await db.deviceKeys.clear();
	resetDeviceKeyCache();
	mocks.remotes = [];
	mocks.unsent = false;
	mocks.resets = 0;
});

describe('getDeviceId', () => {
	it('derives the ID from the key on a new device, and keeps a legacy one', async () => {
		const id = await getDeviceId();
		expect(id).toBe(await deviceIdFromPublicKey((await getDeviceKey()).publicKey));
		expect(await getDeviceId()).toBe(id);

		await deviceSettings.set(DeviceSettingKeys.peerId, UUID);
		expect(await getDeviceId()).toBe(UUID);
	});
});

describe('switchDeviceIdIfReady', () => {
	it('does nothing on a new device or one that switched already', async () => {
		expect(await switchDeviceIdIfReady()).toEqual({ switched: false, reason: 'not-needed' });
		await getDeviceId(); // Derived at first use.
		expect(await switchDeviceIdIfReady()).toEqual({ switched: false, reason: 'not-needed' });
		expect(await deviceSettings.get(DeviceSettingKeys.previousDeviceId)).toBeFalsy();
	});

	it('switches a device that syncs with nothing, keeping the old ID as previous', async () => {
		await deviceSettings.set(DeviceSettingKeys.peerId, UUID);
		const result = await switchDeviceIdIfReady();
		const expected = await deviceIdFromPublicKey((await getDeviceKey()).publicKey);
		expect(result).toEqual({ switched: true, id: expected, previousId: UUID });
		expect(await getDeviceId()).toBe(expected);
		expect(await deviceSettings.get(DeviceSettingKeys.previousDeviceId)).toBe(UUID);
		expect(mocks.resets).toBe(1);
		expect(await switchDeviceIdIfReady()).toEqual({ switched: false, reason: 'not-needed' });
	});

	it('waits while a configured bucket has not received everything, then switches', async () => {
		await deviceSettings.set(DeviceSettingKeys.peerId, UUID);
		mocks.remotes = ['bucket'];
		mocks.unsent = true;
		expect(await switchDeviceIdIfReady()).toEqual({ switched: false, reason: 'unsent-changes' });
		expect(await getDeviceId()).toBe(UUID);

		mocks.unsent = false;
		expect(await switchDeviceIdIfReady()).toMatchObject({ switched: true, previousId: UUID });
	});
});

describe('moving on in a shared bucket', () => {
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

	const payees = async (s: CrdtXactStore) => (await s.list()).map((x) => x.xact.payee).sort();

	function context(
		self: { id: string; privateKey: CryptoKey } | null,
		known: Record<string, string> = {}
	): SigningContext {
		return { self, publicKeyOf: async (id) => known[id] ?? null };
	}

	async function open(
		bucket: MemoryRemoteStore,
		store: CrdtXactStore,
		id: string,
		ctx: SigningContext,
		storage = new MemoryStateStorage()
	) {
		const sync = new DeltaSync({
			kind: 'xacts',
			deviceId: id,
			doc: store,
			remote: new SignedRemoteStore(bucket, ctx),
			storage,
			ignore: () => null // Everyone is trusted here; trust is tested elsewhere.
		});
		await sync.attach();
		return { sync, storage };
	}

	async function newStore(id: string) {
		const store = new CrdtXactStore(`test-switch-${++counter}`, async () => id);
		await store.initialize();
		return store;
	}

	it('keeps every change, restarts delta numbers under the new ID and removes the old objects', async () => {
		const bucket = new MemoryRemoteStore();
		const keyA = await generateDeviceKey();
		const newId = await deviceIdFromPublicKey(keyA.publicKey);

		// B is another (legacy) device; A starts out with a legacy ID too.
		const storeA = await newStore(UUID);
		const storeB = await newStore('b-uuid');
		const b = await open(bucket, storeB, 'b-uuid', context(null, { [newId]: keyA.publicKey }));
		const before = await open(bucket, storeA, UUID, context(null));
		await storeA.append(xact('One'));
		await before.sync.upload();
		await before.sync.publishAck();
		before.sync.dispose();
		expect(bucket.objects.has(deltaKey('xacts', UUID, 1))).toBe(true);

		await b.sync.download();
		expect(await payees(storeB)).toEqual(['One']);

		// A switches: same saved progress, same document, new ID, now signing.
		const self = { id: newId, privateKey: keyA.privateKey };
		const after = await open(
			bucket,
			storeA,
			newId,
			context(self, { [newId]: keyA.publicKey }),
			before.storage
		);
		await storeA.append(xact('Two'));
		const { seq } = await after.sync.upload();
		expect(seq).toBe(1); // Not 2: readers expect a device they have not seen to start at 1.
		expect(bucket.objects.has(deltaKey('xacts', newId, 1))).toBe(true);

		const retired = await after.sync.retire(UUID);
		expect(retired?.deleted).toBeGreaterThan(0);
		const keys = [...bucket.objects.keys()];
		expect(keys.filter((k) => k.includes(UUID))).toEqual([]);
		expect(keys.some((k) => k.startsWith(snapshotKey('xacts', '').slice(0, -5)))).toBe(true);
		expect(await after.sync.retire(UUID)).toBeNull(); // Once per store.

		// B has everything, from A's new objects, and needs no knowledge of the old ones.
		await b.sync.download();
		expect(await payees(storeB)).toEqual(['One', 'Two']);

		// A's progress survives a restart: still under the new ID, still retired.
		after.sync.dispose();
		const again = await open(
			bucket,
			storeA,
			newId,
			context(self, { [newId]: keyA.publicKey }),
			after.storage
		);
		expect(await again.sync.retire(UUID)).toBeNull();
		await storeA.append(xact('Three'));
		expect((await again.sync.upload()).seq).toBe(2);
		await b.sync.download();
		expect(await payees(storeB)).toEqual(['One', 'Three', 'Two']);
	});

	it('starts at delta 1 for a state saved before IDs were recorded, once the ID is key-derived', async () => {
		const bucket = new MemoryRemoteStore();
		const key = await generateDeviceKey();
		const id = await deviceIdFromPublicKey(key.publicKey);
		const storage = new MemoryStateStorage();
		storage.saved = {
			nextSeq: 57,
			snapId: null,
			applied: {},
			bucketSV: {},
			outbox: null,
			acked: 'x'
		};
		const store = await newStore(id);
		const { sync } = await open(
			bucket,
			store,
			id,
			context({ id, privateKey: key.privateKey }, { [id]: key.publicKey }),
			storage
		);
		await store.append(xact('Fresh'));
		expect((await sync.upload()).seq).toBe(1);
		expect(storage.saved?.owner).toBe(id);
		expect(storage.saved?.acked).toBeUndefined();
	});

	it('keeps the numbering of a legacy device that has not switched', async () => {
		const bucket = new MemoryRemoteStore();
		const storage = new MemoryStateStorage();
		storage.saved = { nextSeq: 57, snapId: null, applied: {}, bucketSV: {}, outbox: null };
		const store = await newStore(UUID);
		const { sync } = await open(bucket, store, UUID, context(null), storage);
		await store.append(xact('Same'));
		expect((await sync.upload()).seq).toBe(57);
	});
});
