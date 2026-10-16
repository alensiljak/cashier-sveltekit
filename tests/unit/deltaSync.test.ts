/*
    Delta sync through a remote object store: a device uploads only what changed since its last
    upload, others apply just the deltas they lack, and nothing is sent back or applied twice.
*/
import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/utils/notifier', () => ({ default: { warning: vi.fn() } }));
vi.mock('#lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));

import { CrdtXactStore } from '#lib/storage/crdtXactStore';
import {
	DeltaSync,
	decodeSnapshot,
	deltaKey,
	encodeSnapshot,
	parseKey,
	snapshotKey,
	type DeltaState,
	type DeltaStateStorage
} from '#lib/sync/deltaSync';
import { MemoryRemoteStore, type RemoteStore } from '#lib/sync/remoteStore';

let counter = 0;

const xact = (payee: string) => `2025-01-01 * "${payee}" "Food"
  Expenses:Groceries   10.00 EUR
  Assets:Bank:Checking
`;

class MemoryStateStorage implements DeltaStateStorage {
	saved: DeltaState | null = null;
	async load() {
		return this.saved ? structuredClone(this.saved) : null;
	}
	async save(state: DeltaState) {
		this.saved = structuredClone(state);
	}
}

interface Device {
	id: string;
	store: CrdtXactStore;
	sync: DeltaSync;
	storage: MemoryStateStorage;
}

async function device(
	remote: RemoteStore,
	id: string,
	opts: { ignore?: (deviceId: string) => string | null; attach?: boolean } = {}
): Promise<Device> {
	const store = new CrdtXactStore(`test-delta-${++counter}`, async () => id);
	await store.initialize();
	const storage = new MemoryStateStorage();
	const sync = new DeltaSync({
		kind: 'xacts',
		deviceId: id,
		doc: store,
		remote,
		storage,
		ignore: opts.ignore
	});
	if (opts.attach !== false) await sync.attach();
	return { id, store, sync, storage };
}

const payees = async (d: Device) => (await d.store.list()).map((x) => x.xact.payee).sort();

/** Another run of the same device: same stored state, same document, fresh sync object. */
async function restart(d: Device, remote: RemoteStore, state: DeltaState | null): Promise<Device> {
	d.sync.dispose();
	const storage = new MemoryStateStorage();
	storage.saved = state;
	const sync = new DeltaSync({
		kind: 'xacts',
		deviceId: d.id,
		doc: d.store,
		remote,
		storage
	});
	await sync.attach();
	return { ...d, sync, storage };
}

describe('object keys', () => {
	it('round-trips snapshot and delta keys', () => {
		expect(parseKey('xacts', snapshotKey('xacts', '01ABC'))).toEqual({
			type: 'snapshot',
			id: '01ABC'
		});
		expect(parseKey('xacts', deltaKey('xacts', 'dev-1', 12))).toEqual({
			type: 'delta',
			deviceId: 'dev-1',
			seq: 12
		});
	});

	it('ignores legacy state files and other kinds', () => {
		expect(parseKey('xacts', 'crdt/xacts/dev-1.ydoc')).toBeNull();
		expect(parseKey('xacts', deltaKey('scx', 'dev-1', 1))).toBeNull();
	});

	it('round-trips a snapshot object', () => {
		const update = new Uint8Array([1, 2, 3]);
		const back = decodeSnapshot(encodeSnapshot({ coverage: { a: 3, b: 7 }, update }));
		expect(back.coverage).toEqual({ a: 3, b: 7 });
		expect([...back.update]).toEqual([1, 2, 3]);
	});

	it('rejects a truncated snapshot', () => {
		expect(() => decodeSnapshot(new Uint8Array([0, 0, 0, 99, 1]))).toThrow();
	});
});

describe('upload', () => {
	it('sends only what changed since the last upload', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('One'));
		const first = await a.sync.upload();
		for (let i = 0; i < 20; i++) await a.store.append(xact(`Bulk ${i}`));
		const big = await a.sync.upload();
		await a.store.append(xact('Last'));
		const last = await a.sync.upload();

		expect([first.seq, big.seq, last.seq]).toEqual([1, 2, 3]);
		// One record against twenty: the third delta is far smaller than the second.
		expect(last.bytes).toBeLessThan(big.bytes / 4);
		expect([...remote.objects.keys()]).toEqual([
			deltaKey('xacts', 'A', 1),
			deltaKey('xacts', 'A', 2),
			deltaKey('xacts', 'A', 3)
		]);
	});

	it('uploads nothing when nothing changed', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('One'));
		await a.sync.upload();

		expect((await a.sync.upload()).seq).toBeNull();
		expect(remote.objects.size).toBe(1);
	});

	it('uploads the changes made before it was attached', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A', { attach: false });
		await a.store.append(xact('Before'));
		await a.sync.attach();

		expect((await a.sync.upload()).seq).toBe(1);
		const b = await device(remote, 'B');
		await b.sync.download();
		expect(await payees(b)).toEqual(['Before']);
	});

	it('does not lose the changes when the upload fails', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('One'));
		const put = vi.spyOn(remote, 'put').mockRejectedValueOnce(new Error('offline'));

		await expect(a.sync.upload()).rejects.toThrow('offline');
		put.mockRestore();
		expect((await a.sync.upload()).seq).toBe(1);

		const b = await device(remote, 'B');
		await b.sync.download();
		expect(await payees(b)).toEqual(['One']);
	});

	it('takes the next number when one is already used', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('One'));
		await a.sync.upload();
		// The local counter was lost (settings cleared) while the device ID survived.
		const again = await restart(a, remote, null);
		await again.store.append(xact('Two'));

		expect((await again.sync.upload()).seq).toBe(2);
	});

	it('persists the outbox, and resends it after a restart', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('Queued'));
		await vi.waitFor(() => expect(a.storage.saved?.outbox).toBeTruthy());

		const again = await restart(a, remote, a.storage.saved);
		expect((await again.sync.upload()).seq).toBe(1);
	});

	it('recovers when the outbox is lost', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('One'));
		await a.sync.upload();
		await a.store.append(xact('Two'));
		await vi.waitFor(() => expect(a.storage.saved?.outbox).toBeTruthy());

		// Kept the progress, lost the queued changes.
		const lost = { ...a.storage.saved!, outbox: null };
		const again = await restart(a, remote, lost);
		expect((await again.sync.upload()).seq).toBe(2);

		const b = await device(remote, 'B');
		await b.sync.download();
		expect(await payees(b)).toEqual(['One', 'Two']);
	});

	it('survives a crash between storing the delta and recording it', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('One'));
		const before = structuredClone(a.storage.saved);
		await a.sync.upload();

		// The bucket has delta 1, but the device forgot that it uploaded it.
		const again = await restart(a, remote, before);
		await again.sync.upload();

		const b = await device(remote, 'B');
		const result = await b.sync.download();
		expect(result.errors).toEqual([]);
		expect(await payees(b)).toEqual(['One']);
	});
});

describe('download', () => {
	it('applies only the deltas it lacks, and applies them once', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await a.store.append(xact('One'));
		await a.sync.upload();

		expect((await b.sync.download()).deltas).toBe(1);
		expect((await b.sync.download()).deltas).toBe(0);

		await a.store.append(xact('Two'));
		await a.sync.upload();
		const second = await b.sync.download();
		expect(second.deltas).toBe(1);
		expect(second.changes).toBe(1);
		expect(await payees(b)).toEqual(['One', 'Two']);
	});

	it('does not send back what it downloaded', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await a.store.append(xact('One'));
		await a.sync.upload();
		await b.sync.download();

		expect((await b.sync.upload()).seq).toBeNull();
		expect(await b.sync.status()).toEqual({ upload: false, download: false });
	});

	it('relays changes merged from a peer, which the bucket does not have yet', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		const c = await device(remote, 'C');
		await a.store.append(xact('FromA'));
		// B gets A's records over a peer connection, not through the bucket.
		await b.store.importState(await a.store.exportState());

		expect((await b.sync.upload()).seq).toBe(1);
		await c.sync.download();
		expect(await payees(c)).toEqual(['FromA']);
	});

	it('converges three devices after concurrent edits and deletions', async () => {
		const remote = new MemoryRemoteStore();
		const [a, b, c] = [
			await device(remote, 'A'),
			await device(remote, 'B'),
			await device(remote, 'C')
		];
		const shared = await a.store.append(xact('Shared'));
		await a.sync.upload();
		await b.sync.download();
		await c.sync.download();

		await a.store.remove(shared.id);
		await b.store.append(xact('OnlyB'));
		await c.store.append(xact('OnlyC'));
		for (const d of [a, b, c]) await d.sync.upload();
		for (const d of [a, b, c]) await d.sync.download();

		for (const d of [a, b, c]) expect(await payees(d)).toEqual(['OnlyB', 'OnlyC']);
		expect(await a.sync.status()).toEqual({ upload: false, download: false });
	});

	it('skips a device that is on the ignore list', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B', {
			ignore: (id) => (id === 'A' ? 'Device not trusted' : null)
		});
		await a.store.append(xact('One'));
		await a.sync.upload();

		const result = await b.sync.download();
		expect(result.skipped).toEqual([{ deviceId: 'A', reason: 'Device not trusted' }]);
		expect(await payees(b)).toEqual([]);
		expect((await b.sync.status()).download).toBe(false);
	});

	it('stops at a missing delta and reports the gap', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await a.store.append(xact('One'));
		await a.sync.upload();
		await a.store.append(xact('Two'));
		await a.sync.upload();
		await remote.delete(deltaKey('xacts', 'A', 1));

		const result = await b.sync.download();
		expect(result.gaps).toEqual([{ deviceId: 'A', expected: 1, found: 2 }]);
		expect(result.deltas).toBe(0);
	});

	it('reports a damaged object and carries on with the other devices', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const c = await device(remote, 'C');
		const b = await device(remote, 'B');
		await a.store.append(xact('FromA'));
		await a.sync.upload();
		await c.store.append(xact('FromC'));
		await c.sync.upload();
		await remote.put(deltaKey('xacts', 'A', 1), new Uint8Array([9, 9, 9]));

		const result = await b.sync.download();
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].key).toBe(deltaKey('xacts', 'A', 1));
		expect(await payees(b)).toEqual(['FromC']);
	});

	it('reads again when a listed object was compacted away meanwhile', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await a.store.append(xact('One'));
		await a.sync.upload();
		const get = vi.spyOn(remote, 'get').mockResolvedValueOnce(null);

		const result = await b.sync.download();
		get.mockRestore();
		expect(result.deltas).toBe(1);
		expect(await payees(b)).toEqual(['One']);
	});
});

describe('snapshot', () => {
	/** What a compaction would leave: a snapshot of A's state, and A's older deltas deleted. */
	async function compact(remote: MemoryRemoteStore, a: Device, id: string) {
		const coverage = await a.sync.coverage();
		await remote.put(
			snapshotKey('xacts', id),
			encodeSnapshot({ coverage, update: await a.store.exportState() })
		);
		for (const key of [...remote.objects.keys()]) {
			const parsed = parseKey('xacts', key);
			if (parsed?.type === 'delta' && parsed.seq <= (coverage[parsed.deviceId] ?? 0)) {
				await remote.delete(key);
			}
		}
	}

	it('brings a new device up to date, then continues with later deltas', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('One'));
		await a.sync.upload();
		await a.store.append(xact('Two'));
		await a.sync.upload();
		await compact(remote, a, '01AAA');
		await a.store.append(xact('Three'));
		await a.sync.upload();

		const b = await device(remote, 'B');
		const result = await b.sync.download();
		expect(result.snapshot).toBe(true);
		expect(result.deltas).toBe(1);
		expect(result.gaps).toEqual([]);
		expect(await payees(b)).toEqual(['One', 'Three', 'Two']);
	});

	it('lets a lagging device skip the deltas that were compacted away', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await a.store.append(xact('One'));
		await a.sync.upload();
		await b.sync.download();
		await a.store.append(xact('Two'));
		await a.sync.upload();
		await a.store.append(xact('Three'));
		await a.sync.upload();
		await compact(remote, a, '01AAA');

		const result = await b.sync.download();
		expect(result.snapshot).toBe(true);
		expect(result.gaps).toEqual([]);
		expect(await payees(b)).toEqual(['One', 'Three', 'Two']);
	});

	it('does not take a snapshot it already has, or an older one', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('One'));
		await a.sync.upload();
		await compact(remote, a, '01BBB');
		const b = await device(remote, 'B');
		expect((await b.sync.download()).snapshot).toBe(true);

		expect((await b.sync.download()).snapshot).toBe(false);
		await compact(remote, a, '01AAA');
		expect((await b.sync.download()).snapshot).toBe(false);
	});

	it('does not send the changes it got from a snapshot back', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('One'));
		await a.sync.upload();
		await compact(remote, a, '01AAA');
		const b = await device(remote, 'B');
		await b.sync.download();

		expect((await b.sync.upload()).seq).toBeNull();
	});
});

describe('status', () => {
	it('tells from the listing alone whether there is anything to download', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		expect(await b.sync.status()).toEqual({ upload: false, download: false });

		await a.store.append(xact('One'));
		expect((await a.sync.status()).upload).toBe(true);
		await a.sync.upload();

		const get = vi.spyOn(remote, 'get');
		expect(await b.sync.status()).toEqual({ upload: false, download: true });
		expect(get).not.toHaveBeenCalled();
	});
});
