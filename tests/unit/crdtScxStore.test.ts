/*
    CrdtScxStore tests: the scheduled transactions as a Yjs document, persisted to (fake) IndexedDB.
    Each test uses its own database name, so stores never see each other's state
    unless a test merges them explicitly.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/utils/notifier', () => ({ default: { warning: vi.fn() } }));
vi.mock('$lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));

import { scheduleBackup } from '$lib/services/webdavAutoBackupService';
import { CrdtScxStore } from '$lib/storage/crdtScxStore';
import { SCX_SCHEMA_VERSION, type ScxRecord } from '$lib/storage/crdtScxRecord';
import { Posting, ScheduledTransaction, Xact } from '$lib/data/model';

let counter = 0;
const newStore = (dbName = `test-scx-${++counter}`) => new CrdtScxStore(dbName);

function scx(payee: string, nextDate = '2026-01-01'): ScheduledTransaction {
	const s = new ScheduledTransaction();
	s.nextDate = nextDate;
	s.period = 'months';
	s.count = 1;
	const tx = new Xact();
	tx.date = nextDate;
	tx.payee = payee;
	const p = new Posting();
	p.account = 'Expenses:Rent';
	p.amount = 100;
	p.currency = 'EUR';
	tx.postings = [p];
	s.transaction = tx;
	return s;
}

beforeEach(() => vi.mocked(scheduleBackup).mockClear());

describe('initialisation', () => {
	it('is not initialised until opened, then is', async () => {
		const store = newStore();

		expect(await store.isInitialized()).toBe(false);
		await store.initialize();
		expect(await store.isInitialized()).toBe(true);
	});

	it('starts empty', async () => {
		expect(await newStore().list()).toEqual([]);
	});
});

describe('save / get / list', () => {
	it('adds a record with a new string id and reads it back as the model', async () => {
		const store = newStore();

		const id = await store.save(scx('Rent'));
		const stored = await store.get(id);

		expect(typeof id).toBe('string');
		expect(stored?.id).toBe(id);
		expect(stored?.transaction).toBeInstanceOf(Xact);
		expect(stored?.transaction?.postings[0]).toBeInstanceOf(Posting);
		expect(stored?.transaction?.payee).toBe('Rent');
		expect(scheduleBackup).toHaveBeenCalled();
	});

	it('updates the record when saved again with its id', async () => {
		const store = newStore();
		const id = await store.save(scx('Rent'));

		const edited = (await store.get(id))!;
		edited.nextDate = '2026-02-01';
		expect(await store.save(edited)).toBe(id);

		expect(await store.count()).toBe(1);
		expect((await store.get(id))?.nextDate).toBe('2026-02-01');
	});

	it('does not store the template transaction id', async () => {
		const store = newStore();
		const s = scx('Rent');
		s.transaction!.id = 42;

		const id = await store.save(s);

		expect((await store.get(id))?.transaction?.id).toBeUndefined();
	});

	it('lists by next date, then by id', async () => {
		const store = newStore();
		await store.save(scx('Later', '2026-03-01'));
		await store.save(scx('First', '2026-01-01'));

		expect((await store.list()).map((s) => s.transaction?.payee)).toEqual(['First', 'Later']);
	});

	it('returns undefined for an unknown id', async () => {
		expect(await newStore().get('nope')).toBeUndefined();
	});
});

describe('dueOn', () => {
	it('returns only the records due on that date', async () => {
		const store = newStore();
		await store.save(scx('Today', '2026-05-05'));
		await store.save(scx('Tomorrow', '2026-05-06'));

		expect((await store.dueOn('2026-05-05')).map((s) => s.transaction?.payee)).toEqual(['Today']);
	});
});

describe('bulk operations', () => {
	it('adds many as one update and returns the ids', async () => {
		const store = newStore();
		const onChange = vi.fn();
		await store.initialize();
		store.subscribe(onChange);
		onChange.mockClear();

		const ids = await store.addMany([scx('A'), scx('B')]);

		expect(ids).toHaveLength(2);
		expect(await store.count()).toBe(2);
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it('keeps string ids it is given, and replaces numeric (legacy) ones', async () => {
		const store = newStore();

		const [kept, replaced] = await store.addMany([
			{ ...scx('Kept'), id: 'my-ulid' },
			{ ...scx('Legacy'), id: 7 }
		]);

		expect(kept).toBe('my-ulid');
		expect(replaced).not.toBe(7);
		expect(typeof replaced).toBe('string');
	});

	it('replaces everything', async () => {
		const store = newStore();
		await store.addMany([scx('A'), scx('B')]);

		await store.replaceAll([scx('C')]);

		expect((await store.list()).map((s) => s.transaction?.payee)).toEqual(['C']);
	});

	it('removes by id', async () => {
		const store = newStore();
		const [a, b] = await store.addMany([scx('A'), scx('B')]);

		await store.remove(a);
		expect((await store.list()).map((s) => s.id)).toEqual([b]);

		await store.removeMany([b]);
		expect(await store.count()).toBe(0);
	});

	it('clears', async () => {
		const store = newStore();
		await store.addMany([scx('A'), scx('B')]);

		await store.clear();

		expect(await store.count()).toBe(0);
	});
});

describe('schema version', () => {
	it('refuses to overwrite a record from a newer app version', async () => {
		const store = newStore();
		await store.initialize();
		const newer: ScxRecord = {
			...(JSON.parse(JSON.stringify(scx('Future'))) as ScxRecord),
			id: 'future',
			schemaVersion: SCX_SCHEMA_VERSION + 1
		};
		store.doc.getMap('scx').set('future', newer);

		await expect(store.save({ ...scx('Edit'), id: 'future' })).rejects.toThrow('newer app version');
	});
});

describe('sync', () => {
	it('merges into an independently initialised empty store without a seed', async () => {
		const source = newStore();
		await source.addMany([scx('A'), scx('B')]);
		const target = newStore();
		await target.initialize();

		await target.importState(await source.exportState());

		expect((await target.list()).map((s) => s.transaction?.payee)).toEqual(['A', 'B']);
		expect(await target.contentHash()).toBe(await source.contentHash());
	});

	it('mergeAndDiff brings both sides to the same content', async () => {
		const a = newStore();
		const b = newStore();
		await a.save(scx('FromA'));
		await b.save(scx('FromB'));

		const missingForB = await a.mergeAndDiff(await b.exportState());
		await b.importState(missingForB);

		expect(await a.count()).toBe(2);
		expect(await a.contentHash()).toBe(await b.contentHash());
	});
});
