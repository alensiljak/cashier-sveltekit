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
	ackKey,
	decodeSnapshot,
	deltaKey,
	deviceOfKey,
	encodeSnapshot,
	legacyKey,
	needsCompaction,
	parseKey,
	snapshotKey,
	type DeltaState,
	type DeltaStateStorage
} from '#lib/sync/deltaSync';
import { MemoryRemoteStore, type RemoteStore } from '#lib/sync/remoteStore';
import { aadFor } from '#lib/services/s3RemoteStore';

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
	opts: {
		ignore?: (deviceId: string) => string | null;
		validate?: (record: unknown) => string | null;
		attach?: boolean;
	} = {}
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
		ignore: opts.ignore,
		validate: opts.validate
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

	it('recognises the legacy state file of a device, and ignores other kinds', () => {
		expect(parseKey('xacts', 'crdt/xacts/dev-1.ydoc')).toEqual({
			type: 'legacy',
			deviceId: 'dev-1'
		});
		expect(parseKey('xacts', deltaKey('scx', 'dev-1', 1))).toBeNull();
	});

	it('names the device that wrote an object, but not for a snapshot', () => {
		expect(deviceOfKey('xacts', deltaKey('xacts', 'dev-1', 3))).toBe('dev-1');
		expect(deviceOfKey('xacts', 'crdt/xacts/dev-2.ydoc')).toBe('dev-2');
		expect(deviceOfKey('xacts', snapshotKey('xacts', '01ABC'))).toBeNull();
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
		for (const key of Array.from(remote.objects.keys())) {
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

describe('legacy state files', () => {
	const legacyKey = (id: string) => `crdt/xacts/${id}.ydoc`;

	it('merges a device that still writes its whole state, once per change of the file', async () => {
		const remote = new MemoryRemoteStore();
		const old = await device(remote, 'Old');
		await old.store.append(xact('FromOld'));
		await remote.put(legacyKey('Old'), await old.store.exportState());
		const b = await device(remote, 'B');

		const first = await b.sync.download();
		expect(first.legacy).toBe(1);
		expect(await payees(b)).toEqual(['FromOld']);
		expect((await b.sync.download()).legacy).toBe(0);
		expect((await b.sync.status()).download).toBe(false);

		await old.store.append(xact('MoreFromOld'));
		await new Promise((r) => setTimeout(r, 5));
		await remote.put(legacyKey('Old'), await old.store.exportState());
		expect((await b.sync.status()).download).toBe(true);
		expect((await b.sync.download()).legacy).toBe(1);
		expect(await payees(b)).toEqual(['FromOld', 'MoreFromOld']);
	});

	it('does not send a legacy file back, nor read its own', async () => {
		const remote = new MemoryRemoteStore();
		const old = await device(remote, 'Old');
		await old.store.append(xact('FromOld'));
		await remote.put(legacyKey('Old'), await old.store.exportState());
		const b = await device(remote, 'B');
		await b.sync.download();
		await remote.put(legacyKey('B'), await b.store.exportState());

		expect((await b.sync.upload()).seq).toBeNull();
		expect((await b.sync.download()).legacy).toBe(0);
	});

	it('skips a legacy file of an ignored device', async () => {
		const remote = new MemoryRemoteStore();
		const old = await device(remote, 'Old');
		await old.store.append(xact('FromOld'));
		await remote.put(legacyKey('Old'), await old.store.exportState());
		const b = await device(remote, 'B', { ignore: () => 'Device not trusted' });

		const result = await b.sync.download();
		expect(result.skipped).toEqual([{ deviceId: 'Old', reason: 'Device not trusted' }]);
		expect(await payees(b)).toEqual([]);
	});
});

describe('reading without applying', () => {
	it('returns what a download would apply, snapshot and legacy files first, deltas in order', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await a.store.append(xact('One'));
		await a.sync.upload();
		await a.store.append(xact('Two'));
		await a.sync.upload();

		const unapplied = await b.sync.read({ unappliedOnly: true });
		expect(unapplied.map((u) => u.object.key)).toEqual([
			deltaKey('xacts', 'A', 1),
			deltaKey('xacts', 'A', 2)
		]);
		// Nothing was applied.
		expect(await payees(b)).toEqual([]);

		await b.sync.download();
		expect(await b.sync.read({ unappliedOnly: true })).toEqual([]);
		// The full listing still has everything.
		expect(await b.sync.read({ unappliedOnly: false })).toHaveLength(2);
	});

	it('leaves out ignored devices unless asked', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B', { ignore: () => 'Device not trusted' });
		await a.store.append(xact('One'));
		await a.sync.upload();

		expect(await b.sync.read({ unappliedOnly: false })).toEqual([]);
		expect(await b.sync.read({ unappliedOnly: false, includeIgnored: true })).toHaveLength(1);
	});

	it('stops at a gap, like a download does', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await a.store.append(xact('One'));
		await a.sync.upload();
		await a.store.append(xact('Two'));
		await a.sync.upload();
		await remote.delete(deltaKey('xacts', 'A', 1));

		expect(await b.sync.read({ unappliedOnly: true })).toEqual([]);
	});
});

describe('compaction', () => {
	const keysOf = (remote: MemoryRemoteStore) => [...remote.objects.keys()];
	const snapshotsOf = (remote: MemoryRemoteStore) =>
		keysOf(remote).filter((k) => parseKey('xacts', k)?.type === 'snapshot');
	const deltasOf = (remote: MemoryRemoteStore) =>
		keysOf(remote).filter((k) => parseKey('xacts', k)?.type === 'delta');

	async function pileUp(remote: MemoryRemoteStore, a: Device, count: number) {
		for (let i = 0; i < count; i++) {
			await a.store.append(xact(`Item ${i}`));
			await a.sync.upload();
		}
	}

	it('folds the deltas into a snapshot and deletes those everybody has applied', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await pileUp(remote, a, 3);
		await b.sync.download();

		await b.sync.publishAck();
		const result = (await a.sync.compactIfDue({ isActive: () => true, force: true }))!;
		expect(result.snapshot).not.toBeNull();
		expect(deltasOf(remote)).toEqual([]);
		expect(snapshotsOf(remote)).toHaveLength(1);

		const c = await device(remote, 'C');
		await c.sync.download();
		expect(await payees(c)).toHaveLength(3);
	});

	it('keeps the deltas a device has not applied yet, and that device still catches up', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await pileUp(remote, a, 1);
		await b.sync.download();
		await pileUp(remote, a, 2);

		await b.sync.publishAck();
		await a.sync.compactIfDue({ isActive: () => true, force: true });
		expect(deltasOf(remote)).toEqual([deltaKey('xacts', 'A', 2), deltaKey('xacts', 'A', 3)]);

		const result = await b.sync.download();
		expect(result.snapshot).toBe(true);
		expect(result.gaps).toEqual([]);
		expect(await payees(b)).toHaveLength(3);
	});

	it('lets a device that never acknowledges be left out of the decision', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await pileUp(remote, a, 2);

		// Only the active devices are passed in; a dead one is not among them.
		await a.sync.compact({});
		expect(deltasOf(remote)).toEqual([]);
	});

	it('does nothing when there is nothing to delete', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('One'));
		await a.sync.upload();

		const result = await a.sync.compact({ B: {} });
		expect(result).toEqual({ snapshot: null, deleted: 0 });
		expect(snapshotsOf(remote)).toEqual([]);
	});

	it('keeps only the newest two snapshots', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		for (let i = 0; i < 4; i++) {
			await a.store.append(xact(`Round ${i}`));
			await a.sync.upload();
			await a.sync.compact({});
		}
		expect(snapshotsOf(remote)).toHaveLength(2);
	});

	it('does not delete anything when it could not merge everything first', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await pileUp(remote, a, 2);
		await remote.put(deltaKey('xacts', 'A', 1), new Uint8Array([9, 9, 9]));

		const result = await b.sync.compact({});
		expect(result.snapshot).toBeNull();
		expect(result.skipped).toBeDefined();
		expect(deltasOf(remote)).toHaveLength(2);
	});

	it('decides from the listing when it is time', () => {
		const delta = (n: number, ageDays: number) => ({
			key: deltaKey('xacts', 'A', n),
			type: 'delta' as const,
			deviceId: 'A',
			size: 10,
			lastModified: new Date(Date.now() - ageDays * 86400_000)
		});
		const snapshot = (ageDays: number) => ({
			key: snapshotKey('xacts', '01A'),
			type: 'snapshot' as const,
			deviceId: null,
			size: 10,
			lastModified: new Date(Date.now() - ageDays * 86400_000)
		});
		const many = Array.from({ length: 30 }, (_, i) => delta(i + 1, 0));

		expect(needsCompaction([])).toBe(false);
		expect(needsCompaction([snapshot(30)])).toBe(false);
		expect(needsCompaction([delta(1, 0), snapshot(1)])).toBe(false);
		expect(needsCompaction(many)).toBe(true);
		expect(needsCompaction([delta(1, 0), snapshot(8)])).toBe(true);
		expect(needsCompaction([delta(1, 9)])).toBe(true);
	});
});

describe('acknowledgements', () => {
	const ackOf = async (remote: MemoryRemoteStore, id: string) =>
		JSON.parse(new TextDecoder().decode((await remote.get(ackKey('xacts', id)))!));

	it('say what was applied, and only when that changed', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await a.store.append(xact('One'));
		await a.sync.upload();

		expect(await b.sync.publishAck()).toBe(true);
		expect(await ackOf(remote, 'B')).toEqual({ snapId: null, applied: {} });
		expect(await b.sync.publishAck()).toBe(false);

		await b.sync.download();
		expect(await b.sync.publishAck()).toBe(true);
		expect(await ackOf(remote, 'B')).toEqual({ snapId: null, applied: { A: 1 } });

		// Uploading its own changes does not need telling.
		await b.store.append(xact('Two'));
		await b.sync.upload();
		expect(await b.sync.publishAck()).toBe(false);
	});

	it('are not mistaken for something to download', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await a.sync.publishAck();

		expect((await b.sync.download()).foreign).toBe(0);
		expect(await b.sync.status()).toEqual({ upload: false, download: false });
		expect(await b.sync.read({ unappliedOnly: false, includeIgnored: true })).toEqual([]);
	});

	describe('when compacting', () => {
		async function pile(remote: MemoryRemoteStore) {
			const a = await device(remote, 'A');
			const b = await device(remote, 'B');
			for (const p of ['One', 'Two']) {
				await a.store.append(xact(p));
				await a.sync.upload();
			}
			return { a, b };
		}
		const deltaCount = (remote: MemoryRemoteStore) =>
			[...remote.objects.keys()].filter((k) => parseKey('xacts', k)?.type === 'delta').length;

		it('waits for an active device that has not applied the deltas yet', async () => {
			const remote = new MemoryRemoteStore();
			const { a, b } = await pile(remote);
			await b.sync.publishAck();

			await a.sync.compactIfDue({ isActive: () => true, force: true });
			expect(deltaCount(remote)).toBe(2);
		});

		it('ignores a device that is not active (not trusted)', async () => {
			const remote = new MemoryRemoteStore();
			const { a, b } = await pile(remote);
			await b.sync.publishAck();

			await a.sync.compactIfDue({ isActive: (id) => id !== 'B', force: true });
			expect(deltaCount(remote)).toBe(0);
		});

		it('ignores a device that has not acknowledged for a long time', async () => {
			const remote = new MemoryRemoteStore();
			const { a, b } = await pile(remote);
			await b.sync.publishAck();
			remote.objects.get(ackKey('xacts', 'B'))!.lastModified = new Date(
				Date.now() - 31 * 86400_000
			);

			await a.sync.compactIfDue({ isActive: () => true, force: true });
			expect(deltaCount(remote)).toBe(0);
		});

		it('is not held back by a device without an acknowledgement', async () => {
			const remote = new MemoryRemoteStore();
			const { a } = await pile(remote);

			await a.sync.compactIfDue({ isActive: () => true, force: true });
			expect(deltaCount(remote)).toBe(0);
		});

		it('is held back by an acknowledgement it cannot read', async () => {
			const remote = new MemoryRemoteStore();
			const { a } = await pile(remote);
			await remote.put(ackKey('xacts', 'B'), new Uint8Array([1, 2, 3]));

			await a.sync.compactIfDue({ isActive: () => true, force: true });
			expect(deltaCount(remote)).toBe(2);
		});

		it('does nothing before it is time, unless forced', async () => {
			const remote = new MemoryRemoteStore();
			const { a } = await pile(remote);

			expect(await a.sync.compactIfDue({ isActive: () => true })).toBeNull();
			expect(deltaCount(remote)).toBe(2);
		});

		it('is a reason to remove a forgotten device along with its acknowledgement', async () => {
			const remote = new MemoryRemoteStore();
			const { a, b } = await pile(remote);
			await b.store.append(xact('FromB'));
			await b.sync.upload();
			await b.sync.publishAck();

			await a.sync.forget('B');
			expect([...remote.objects.keys()].some((k) => k.includes('B.'))).toBe(false);
		});
	});
});

describe('reset', () => {
	const emptied = async (d: Device) => {
		for (const { id } of await d.store.list()) await d.store.remove(id);
	};

	it('publishes the new generation and the others follow without the old records', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await a.store.append(xact('Old'));
		await a.sync.upload();
		await b.sync.download();
		expect(await payees(b)).toEqual(['Old']);

		await emptied(a);
		await a.sync.upload();
		await b.sync.download();
		await a.store.reset();
		await a.store.append(xact('After'));
		await a.sync.upload();

		const keys = [...remote.objects.keys()];
		// The old generation's deltas of A are gone. The snapshot holds the new generation, the
		// record added since included, so no delta is needed for it.
		expect(keys.filter((k) => parseKey('xacts', k)?.type === 'snapshot')).toHaveLength(1);
		expect(keys.filter((k) => parseKey('xacts', k)?.type === 'delta')).toHaveLength(0);

		await b.sync.download();
		expect(await payees(b)).toEqual(['After']);
		expect((await b.sync.upload()).seq).toBeNull();

		const c = await device(remote, 'C');
		await c.sync.download();
		expect(await payees(c)).toEqual(['After']);
	});

	it('remembers across a restart that the snapshot is still to be published', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('Old'));
		await a.sync.upload();
		await emptied(a);
		await a.store.reset();
		await vi.waitFor(() => expect(a.storage.saved?.pendingSnapshot).toBe(true));

		const again = await restart(a, remote, a.storage.saved);
		await again.sync.upload();
		expect(
			[...remote.objects.keys()].filter((k) => parseKey('xacts', k)?.type === 'snapshot')
		).toHaveLength(1);
	});

	it('does not send the adopted generation back', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await a.store.append(xact('Old'));
		await a.sync.upload();
		await b.sync.download();
		await emptied(a);
		await a.store.reset();
		await a.sync.upload();

		await b.sync.download();
		expect((await b.sync.upload()).seq).toBeNull();
	});
});

describe('forgetting a device', () => {
	it('merges what it wrote, publishes that in a snapshot, then removes its objects', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const gone = await device(remote, 'Gone');
		const c = await device(remote, 'C');
		await gone.store.append(xact('FromGone'));
		await gone.sync.upload();
		await remote.put(legacyKey('xacts', 'Gone'), await gone.store.exportState());

		const result = await a.sync.forget('Gone');
		expect(result.deleted).toBe(2);
		expect([...remote.objects.keys()].some((k) => k.includes('Gone'))).toBe(false);

		// C never saw the deltas, but gets their content from the snapshot.
		await c.sync.download();
		expect(await payees(c)).toEqual(['FromGone']);
	});

	it('stops when it cannot merge everything first', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const gone = await device(remote, 'Gone');
		await gone.store.append(xact('FromGone'));
		await gone.sync.upload();
		await remote.put(deltaKey('xacts', 'Gone', 1), new Uint8Array([9, 9, 9]));

		await expect(a.sync.forget('Gone')).rejects.toThrow(/merge everything/);
		expect(remote.objects.has(deltaKey('xacts', 'Gone', 1))).toBe(true);
	});
});

describe('legacy files after the move to deltas', () => {
	const legacy = (id: string) => legacyKey('xacts', id);

	it('removes the legacy file of a device once its first delta is held here', async () => {
		const remote = new MemoryRemoteStore();
		const old = await device(remote, 'Old');
		await old.store.append(xact('FromOld'));
		await remote.put(legacy('Old'), await old.store.exportState());
		const b = await device(remote, 'B');

		// Not yet moved on: no delta of its own.
		await b.sync.download();
		expect(await b.sync.cleanLegacy()).toBe(0);
		expect(remote.objects.has(legacy('Old'))).toBe(true);

		// It upgrades: its first delta carries everything its legacy file held.
		await old.sync.upload();
		await b.sync.download();
		expect(await b.sync.cleanLegacy()).toBe(1);
		expect(remote.objects.has(legacy('Old'))).toBe(false);
		expect(await payees(b)).toEqual(['FromOld']);
	});

	it('removes its own legacy file after its first upload', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('One'));
		await remote.put(legacy('A'), await a.store.exportState());

		expect(await a.sync.cleanLegacy()).toBe(0);
		await a.sync.upload();
		expect(await a.sync.cleanLegacy()).toBe(1);
		expect(remote.objects.has(legacy('A'))).toBe(false);
	});

	it('keeps the legacy file of a device that is still on the old version', async () => {
		const remote = new MemoryRemoteStore();
		const old = await device(remote, 'Old');
		await old.store.append(xact('FromOld'));
		await remote.put(legacy('Old'), await old.store.exportState());
		const a = await device(remote, 'A');
		await a.sync.download();
		await a.store.append(xact('Mine'));
		await a.sync.upload();

		expect(await a.sync.cleanLegacy()).toBe(0);
		expect(remote.objects.has(legacy('Old'))).toBe(true);
	});
});

describe('size limit and validation', () => {
	it('does not read an object larger than the limit', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await a.store.append(xact('One'));
		await a.sync.upload();
		const info = remote.objects.get(deltaKey('xacts', 'A', 1))!;
		const real = remote.list.bind(remote);
		vi.spyOn(remote, 'list').mockImplementation(async (prefix) =>
			(await real(prefix)).map((o) => ({ ...o, size: info.body.length + 65 * 1024 * 1024 }))
		);
		const get = vi.spyOn(remote, 'get');

		const result = await b.sync.download();
		expect(result.errors[0].message).toMatch(/Larger than the limit/);
		expect(get).not.toHaveBeenCalled();
		expect(await payees(b)).toEqual([]);
	});

	it('reports records that came in but are not valid', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B', {
			validate: (r) =>
				(r as { payee?: string }).payee === 'Bad' ? 'The payee is not allowed' : null
		});
		await a.store.append(xact('Good'));
		await a.store.append(xact('Bad'));
		await a.sync.upload();

		const result = await b.sync.download();
		expect(result.invalid).toHaveLength(1);
		expect(result.invalid[0].reason).toBe('The payee is not allowed');
		expect(result.changes).toBe(2);
	});

	it('accepts what the app itself writes', async () => {
		const { validateRecord } = await import('#lib/storage/crdtXactRecord');
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B', { validate: validateRecord });
		await a.store.append(xact('Fine'));
		await a.sync.upload();

		expect((await b.sync.download()).invalid).toEqual([]);
	});

	it('knows a record that is not shaped like a transaction', async () => {
		const { validateRecord } = await import('#lib/storage/crdtXactRecord');
		expect(validateRecord(null)).not.toBeNull();
		expect(validateRecord({ id: 'x', schemaVersion: 1, postings: 'no' })).toMatch(/postings/);
		expect(validateRecord({ id: 'x', schemaVersion: 1, postings: [{}] })).toMatch(/account/);
		expect(validateRecord({ id: 'x', schemaVersion: 1, postings: [] })).toBeNull();
	});
});

describe('automatic reset', () => {
	/** Many records created and deleted: what is left is the ids of those that were deleted. */
	async function churn(d: Device, count = 100) {
		for (let i = 0; i < count; i++) await d.store.append(xact(`Churn ${i}`));
		for (const { id } of await d.store.list()) await d.store.remove(id);
	}
	const reset = (d: Device, trusted: string[]) => d.sync.resetIfDue({ trusted });
	const snapshots = (remote: MemoryRemoteStore) =>
		[...remote.objects.keys()].filter((k) => parseKey('xacts', k)?.type === 'snapshot');

	it('resets an emptied document once every trusted device has applied the deletions', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await churn(a);
		await a.sync.upload();
		await b.sync.download();
		await b.sync.publishAck();
		const before = (await a.store.exportState()).length;

		expect(await reset(a, ['B'])).toEqual({ reset: true });

		expect((await a.store.exportState()).length).toBeLessThan(before / 4);
		expect(snapshots(remote)).toHaveLength(1);
		await b.sync.download();
		expect((await b.store.exportState()).length).toBeLessThan(before / 4);
		expect(await payees(b)).toEqual([]);
	});

	it('waits for a trusted device that has not applied the deletions', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await b.sync.download();
		await b.sync.publishAck();
		await churn(a);
		await a.sync.upload();

		const result = await reset(a, ['B']);
		expect(result.reset).toBe(false);
		expect(result.reason).toMatch(/Waiting for B/);
		expect(snapshots(remote)).toEqual([]);
	});

	it('waits for a trusted device that has synced but never acknowledged', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await b.store.append(xact('FromB'));
		await b.sync.upload();
		await a.sync.download();
		await churn(a);
		await a.store.append(xact('Keep'));
		for (const { id } of await a.store.list()) await a.store.remove(id);

		expect((await reset(a, ['B'])).reason).toMatch(/Waiting for B/);
	});

	it('does not wait for a trusted device that has not acknowledged for a long time', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await b.sync.publishAck();
		remote.objects.get(ackKey('xacts', 'B'))!.lastModified = new Date(Date.now() - 31 * 86400_000);
		await churn(a);
		await a.sync.upload();

		expect((await reset(a, ['B'])).reset).toBe(true);
	});

	it('ignores a trusted device that has never synced, and devices that are not trusted', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A', {
			ignore: (id) => (id === 'Stranger' ? 'Device not trusted' : null)
		});
		const stranger = await device(remote, 'Stranger');
		await stranger.store.append(xact('X'));
		await stranger.sync.upload();
		await churn(a);

		expect((await reset(a, ['NeverSynced'])).reset).toBe(true);
	});

	it('does not reset while records remain', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await churn(a);
		await a.store.append(xact('Keep'));

		expect(await reset(a, [])).toEqual({ reset: false, reason: 'Records remain' });
	});

	it('does not reset when there is little to clear', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		await a.store.append(xact('One'));
		for (const { id } of await a.store.list()) await a.store.remove(id);

		expect((await reset(a, [])).reason).toBe('Nothing worth clearing');
	});

	it('does not reset when what came in from the bucket brought records back', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await b.store.append(xact('FromB'));
		await b.sync.upload();
		await churn(a);

		expect(await reset(a, ['B'])).toEqual({ reset: false, reason: 'Records remain' });
	});

	it('keeps what another device created and had not uploaded', async () => {
		const remote = new MemoryRemoteStore();
		const a = await device(remote, 'A');
		const b = await device(remote, 'B');
		await churn(a);
		await a.sync.upload();
		await b.sync.download();
		await b.sync.publishAck();
		await b.store.append(xact('Offline')); // Made after the last sync, not uploaded.

		expect((await reset(a, ['B'])).reset).toBe(true);
		await b.sync.download();
		expect(await payees(b)).toEqual(['Offline']);
		await b.sync.upload();
		await a.sync.download();
		expect(await payees(a)).toEqual(['Offline']);
	});
});

describe('S3 object binding', () => {
	it('binds deltas and snapshots to their key, but not the legacy state files', () => {
		expect(aadFor(deltaKey('xacts', 'A', 1))).toBeDefined();
		expect(aadFor(snapshotKey('xacts', '01ABC'))).toBeDefined();
		expect(aadFor('crdt/xacts/A.ydoc')).toBeUndefined();
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
