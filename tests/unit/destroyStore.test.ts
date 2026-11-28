/*
    Destroying a device's copy of a CRDT store: it concerns that device only, and later syncs get
    everything back from the bucket, the device's own uploads included. Runs through the registry
    and the saved progress in the device settings, as the app does.
*/
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/utils/notifier', () => ({ default: { warning: vi.fn() } }));
vi.mock('#lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));
// Nothing is configured, so no sync is attached on its own: the tests set up the ones they use.
vi.mock('#lib/services/syncOptions.svelte', () => ({ isSyncOptionEnabled: async () => false }));

import db from '#lib/data/db';
import { TrustedPeer, type ScheduledTransaction } from '#lib/data/model';
import { CrdtScxStore } from '#lib/storage/crdtScxStore';
import { scheduleBackup } from '#lib/services/webdavAutoBackupService';
import { setAdoptConfirm } from '#lib/storage/crdtDocStore';
import { CrdtXactStore } from '#lib/storage/crdtXactStore';
import { deltaKey, parseKey, type DeltaSync } from '#lib/sync/deltaSync';
import {
	afterSync,
	destroyLocalStore,
	getDeltaSync,
	resetDeltaSyncRegistry
} from '#lib/sync/deltaSyncRegistry';
import { MemoryRemoteStore, ObjectRejectedError } from '#lib/sync/remoteStore';

let counter = 0;

const xact = (payee: string) => `2025-01-01 * "${payee}" "Food"
  Expenses:Groceries   10.00 EUR
  Assets:Bank:Checking
`;

interface Device {
	id: string;
	dbName: string;
	store: CrdtXactStore;
}

async function device(id: string): Promise<Device> {
	const dbName = `test-destroy-${++counter}`;
	const store = new CrdtXactStore(dbName, async () => id);
	await store.initialize();
	return { id, dbName, store };
}

/**
 * Device A is "this device": only its progress is saved in the device settings, which in a test
 * all devices would share. So every other device uses a bucket name of its own for the same
 * bucket.
 */
const syncOf = (d: Device, remote: MemoryRemoteStore, remoteId: string): Promise<DeltaSync> =>
	getDeltaSync({
		kind: 'xacts',
		deviceId: d.id,
		store: d.store,
		remote,
		remoteId: d.id === 'A' ? remoteId : `${remoteId}|${d.id}`
	});

const payees = async (d: Device) => (await d.store.list()).map((x) => x.xact.payee).sort();

const keys = (remote: MemoryRemoteStore) => [...remote.objects.keys()].sort();

async function removePayee(d: Device, payee: string) {
	for (const { id, xact } of await d.store.list()) {
		if (xact.payee === payee) await d.store.remove(id);
	}
}

let bucket = 0;
const newBucket = () => `bucket-${++bucket}`;

beforeEach(async () => {
	resetDeltaSyncRegistry();
	setAdoptConfirm(undefined);
	vi.mocked(scheduleBackup).mockClear();
	await db.deviceSettings.clear();
	await db.peers.clear();
	for (const id of ['A', 'B']) {
		const peer = new TrustedPeer();
		peer.id = id;
		await db.peers.put(peer);
	}
});

describe('destroy', () => {
	it('empties the store, also across a reopen, and leaves no history', async () => {
		const a = await device('A');
		await a.store.append(xact('One'));

		await a.store.destroy();

		expect(await a.store.list()).toEqual([]);
		expect(await a.store.isInitialized()).toBe(true);
		expect((await a.store.stateVector()).length).toBe(1);
		const reopened = new CrdtXactStore(a.dbName, async () => 'A');
		expect(await reopened.list()).toEqual([]);
	});

	it('lets a backup bring back what was deleted since', async () => {
		const a = await device('A');
		await a.store.append(xact('One'));
		const backup = await a.store.exportState();
		await removePayee(a, 'One');
		await a.store.importState(backup);
		expect(await payees(a)).toEqual([]);

		await a.store.destroy();
		await a.store.importState(backup);

		expect(await payees(a)).toEqual(['One']);
	});

	it('keeps subscribers and new writes working', async () => {
		const a = await device('A');
		await a.store.append(xact('One'));
		const changed = vi.fn();
		a.store.subscribe(changed);

		await a.store.destroy();
		expect(changed).toHaveBeenCalled();
		changed.mockClear();
		await a.store.append(xact('Two'));

		expect(changed).toHaveBeenCalled();
		expect(await payees(a)).toEqual(['Two']);
	});

	it('sends nothing, removes nothing and starts no backup', async () => {
		const remote = new MemoryRemoteStore();
		const id = newBucket();
		const a = await device('A');
		await a.store.append(xact('One'));
		await (await syncOf(a, remote, id)).upload();
		const before = keys(remote);
		vi.mocked(scheduleBackup).mockClear();

		await destroyLocalStore('xacts', a.store);

		expect(keys(remote)).toEqual(before);
		expect(scheduleBackup).not.toHaveBeenCalled();
		const b = await device('B');
		await (await syncOf(b, remote, id)).download();
		expect(await payees(b)).toEqual(['One']);
	});
});

describe('sync after destroy', () => {
	it("gets back this device's own uploads, and deletions of them", async () => {
		const remote = new MemoryRemoteStore();
		const id = newBucket();
		const a = await device('A');
		const b = await device('B');
		await a.store.append(xact('Mine'));
		await a.store.append(xact('Gone'));
		await (await syncOf(a, remote, id)).upload();
		await (await syncOf(b, remote, id)).download();
		await removePayee(b, 'Gone');
		await b.store.append(xact('Theirs'));
		await (await syncOf(b, remote, id)).upload();
		await (await syncOf(a, remote, id)).download();

		await destroyLocalStore('xacts', a.store);
		const result = await (await syncOf(a, remote, id)).download();

		expect(result.errors).toEqual([]);
		expect(result.foreign).toBeGreaterThan(0);
		expect(await payees(a)).toEqual(['Mine', 'Theirs']);
	});

	it('does so when only this device has uploaded', async () => {
		const remote = new MemoryRemoteStore();
		const id = newBucket();
		const a = await device('A');
		await a.store.append(xact('Mine'));
		await (await syncOf(a, remote, id)).upload();

		await destroyLocalStore('xacts', a.store);
		const sync = await syncOf(a, remote, id);
		expect((await sync.status()).download).toBe(true);
		expect((await sync.review()).download).toBe(true);
		const result = await sync.download();

		expect(result.foreign).toBe(1);
		expect(await payees(a)).toEqual(['Mine']);
		expect((await sync.status()).download).toBe(false);
	});

	it('goes on numbering its uploads, so that the others read them', async () => {
		const remote = new MemoryRemoteStore();
		const id = newBucket();
		const a = await device('A');
		const b = await device('B');
		await a.store.append(xact('One'));
		await (await syncOf(a, remote, id)).upload();
		await (await syncOf(b, remote, id)).download();

		await destroyLocalStore('xacts', a.store);
		const sync = await syncOf(a, remote, id);
		await sync.download();
		await a.store.append(xact('Two'));
		expect((await sync.upload()).seq).toBe(2);

		await (await syncOf(b, remote, id)).download();
		expect(await payees(b)).toEqual(['One', 'Two']);
	});

	it('recovers from a snapshot, and numbers on when its own deltas are gone', async () => {
		const remote = new MemoryRemoteStore();
		const id = newBucket();
		const a = await device('A');
		const first = await syncOf(a, remote, id);
		await a.store.append(xact('One'));
		await first.upload();
		await first.compact({});
		expect(keys(remote).some((k) => parseKey('xacts', k)?.type === 'delta')).toBe(false);

		// Also without any saved progress for this bucket, e.g. the same bucket under a new address.
		await destroyLocalStore('xacts', a.store);
		await db.deviceSettings.where('key').startsWith('delta-sync-state:').delete();
		resetDeltaSyncRegistry();
		const sync = await syncOf(a, remote, id);
		await a.store.append(xact('Early'));
		// An upload before the first download must not reuse number 1.
		expect((await sync.upload()).seq).toBe(2);
		await sync.download();

		expect(await payees(a)).toEqual(['Early', 'One']);
	});

	it('drops what was waiting to be uploaded', async () => {
		const remote = new MemoryRemoteStore();
		const id = newBucket();
		const a = await device('A');
		await syncOf(a, remote, id);
		await a.store.append(xact('Mistake'));

		await destroyLocalStore('xacts', a.store);
		const sync = await syncOf(a, remote, id);
		await sync.download();

		expect((await sync.upload()).seq).toBeNull();
		expect(keys(remote)).toEqual([]);
	});

	it('covers a bucket whose sync is not set up at the time', async () => {
		const remote = new MemoryRemoteStore();
		const id = newBucket();
		const a = await device('A');
		await a.store.append(xact('Mine'));
		await (await syncOf(a, remote, id)).upload();
		resetDeltaSyncRegistry();

		await destroyLocalStore('xacts', a.store);
		await (await syncOf(a, remote, id)).download();

		expect(await payees(a)).toEqual(['Mine']);
	});

	it('does not let a sync obtained before save its old progress', async () => {
		const remote = new MemoryRemoteStore();
		const id = newBucket();
		const a = await device('A');
		await a.store.append(xact('Mine'));
		const held = await syncOf(a, remote, id);
		await held.upload();

		await destroyLocalStore('xacts', a.store);
		await expect(held.upload()).rejects.toThrow(/destroyed/);
		await expect(held.download()).rejects.toThrow(/destroyed/);
		await (await syncOf(a, remote, id)).download();

		expect(await payees(a)).toEqual(['Mine']);
	});

	it('gets to the current state after an older backup was restored', async () => {
		const remote = new MemoryRemoteStore();
		const id = newBucket();
		const a = await device('A');
		await a.store.append(xact('Old'));
		await (await syncOf(a, remote, id)).upload();
		const backup = await a.store.exportState();
		await removePayee(a, 'Old');
		await a.store.append(xact('New'));
		await (await syncOf(a, remote, id)).upload();

		await destroyLocalStore('xacts', a.store);
		await a.store.importState(backup);
		expect(await payees(a)).toEqual(['Old']);
		await (await syncOf(a, remote, id)).download();

		expect(await payees(a)).toEqual(['New']);
	});

	// A restore from saved state keeps the history. Restoring a plain list does not, and then
	// old versions can win over newer ones.
	it('does the same for scheduled transactions restored from saved state', async () => {
		const remote = new MemoryRemoteStore();
		const remoteId = newBucket();
		const store = new CrdtScxStore(`test-destroy-scx-${++counter}`);
		await store.initialize();
		const sync = () => getDeltaSync({ kind: 'scx', deviceId: 'A', store, remote, remoteId });
		const scx = (remarks: string, id?: string) =>
			({ id, nextDate: '2025-01-01', remarks }) as ScheduledTransaction & { id?: string };
		const edited = await store.save(scx('old'));
		const deleted = await store.save(scx('deleted'));
		await (await sync()).upload();
		const backup = await store.exportState();
		await store.save(scx('new', edited));
		await store.remove(deleted);
		await (await sync()).upload();

		await destroyLocalStore('scx', store);
		await store.importState(backup);
		await (await sync()).download();

		expect((await store.list()).map((s) => s.remarks)).toEqual(['new']);
	});

	it('follows a reset made elsewhere, without asking about unsent changes', async () => {
		const remote = new MemoryRemoteStore();
		const id = newBucket();
		const a = await device('A');
		const b = await device('B');
		await a.store.append(xact('Old'));
		await (await syncOf(a, remote, id)).upload();
		const backup = await a.store.exportState();
		const theirs = await syncOf(b, remote, id);
		await theirs.download();
		await removePayee(b, 'Old');
		await b.store.reset();
		await theirs.upload();
		const confirm = vi.fn(() => false);
		setAdoptConfirm(confirm);

		await destroyLocalStore('xacts', a.store);
		await a.store.importState(backup);
		await (await syncOf(a, remote, id)).download();

		expect(confirm).not.toHaveBeenCalled();
		expect(await payees(a)).toEqual([]);
	});
});

describe('an unfinished rebuild', () => {
	/** A's first delta, then B's, which deletes a record of A: B's depends on A's. */
	async function dependentDeltas() {
		const remote = new MemoryRemoteStore();
		const id = newBucket();
		const a = await device('A');
		const b = await device('B');
		await a.store.append(xact('Mine'));
		await a.store.append(xact('Gone'));
		await (await syncOf(a, remote, id)).upload();
		await (await syncOf(b, remote, id)).download();
		await removePayee(b, 'Gone');
		await (await syncOf(b, remote, id)).upload();
		await (await syncOf(a, remote, id)).download();
		await destroyLocalStore('xacts', a.store);
		return { remote, id, a, b };
	}

	it('stays open over a gap, and removes and publishes nothing meanwhile', async () => {
		const { remote, id, a } = await dependentDeltas();
		const own = deltaKey('xacts', 'A', 1);
		const kept = (await remote.get(own))!;
		remote.objects.delete(own);
		await remote.put(deltaKey('xacts', 'A', 2), kept);
		const before = keys(remote);

		const sync = await syncOf(a, remote, id);
		expect((await sync.download()).gaps).toHaveLength(1);

		expect(await sync.publishAck()).toBe(false);
		expect(await sync.cleanLegacy()).toBe(0);
		expect((await sync.compact({})).snapshot).toBeNull();
		expect((await sync.resetIfDue({ trusted: [] })).reset).toBe(false);
		await expect(sync.forget('B')).rejects.toThrow();
		await expect(sync.retire('B')).rejects.toThrow();
		await afterSync(sync, { compact: true });
		expect(keys(remote)).toEqual(before);
	});

	it('starts over after a restart, so nothing waiting for a missing change is lost', async () => {
		const { remote, id, a } = await dependentDeltas();
		// B's delta is read first, and A's, which it builds on, is refused: B's counts as applied
		// while Yjs only holds it in memory.
		const list = remote.list.bind(remote);
		const get = remote.get.bind(remote);
		const reversed = vi
			.spyOn(remote, 'list')
			.mockImplementation(async (prefix) => (await list(prefix)).reverse());
		const broken = vi.spyOn(remote, 'get').mockImplementation(async (key) => {
			if (key === deltaKey('xacts', 'A', 1)) throw new ObjectRejectedError(key, 'refused');
			return get(key);
		});
		const failed = await (await syncOf(a, remote, id)).download();
		expect(failed.deltas).toBe(1);
		expect(failed.errors).toHaveLength(1);
		broken.mockRestore();
		reversed.mockRestore();

		resetDeltaSyncRegistry();
		const reopened = { ...a, store: new CrdtXactStore(a.dbName, async () => 'A') };
		const sync = await syncOf(reopened, remote, id);
		await sync.download();

		expect(await payees(reopened)).toEqual(['Mine']);
		expect(await sync.publishAck()).toBe(true);
	});
});
