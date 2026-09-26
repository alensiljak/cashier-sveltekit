/*
    CrdtXactStore tests: the Yjs working set, persisted to (fake) IndexedDB.
    Each test uses its own database name, so stores never see each other's state
    unless a test merges them explicitly.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Reading a newer-schema record raises a toast; the real toaster needs a live document.
vi.mock('$lib/utils/notifier', () => ({ default: { warning: vi.fn() } }));
vi.mock('$lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));

import { scheduleBackup } from '$lib/services/webdavAutoBackupService';
import { CrdtXactStore } from '$lib/storage/crdtXactStore';
import { XACT_SCHEMA_VERSION } from '$lib/storage/crdtXactRecord';

let counter = 0;
function newStore(origin = 'device-A', dbName = `test-xacts-${++counter}`) {
	return new CrdtXactStore(dbName, async () => origin);
}

const groceries = (
	date: string,
	payee = 'Supermarket',
	amount = '45.50'
) => `${date} * "${payee}" "Food"
  Expenses:Groceries   ${amount} EUR
  Assets:Bank:Checking
`;

beforeEach(() => vi.mocked(scheduleBackup).mockClear());

describe('initialisation', () => {
	it('is not initialised until opened, then is', async () => {
		const store = newStore();

		expect(await store.isInitialized()).toBe(false);
		await store.initialize();
		expect(await store.isInitialized()).toBe(true);
	});

	it('is initialised for a second store on the same database', async () => {
		const first = newStore('A', 'shared-db');
		await first.initialize();

		expect(await newStore('B', 'shared-db').isInitialized()).toBe(true);
	});

	it('starts empty', async () => {
		const store = newStore();

		expect(await store.list()).toEqual([]);
		expect(await store.toBeancount()).toBe('');
	});
});

describe('append / list', () => {
	it('parses the text into a stored transaction with a stable id and origin', async () => {
		const store = newStore('device-A');

		const stored = await store.append(groceries('2025-08-10'));

		expect(stored.id).toBeTruthy();
		expect(stored.origin).toBe('device-A');
		expect(stored.xact).toMatchObject({ date: '2025-08-10', payee: 'Supermarket' });
		expect(stored.xact.postings.map((p) => p.account)).toEqual([
			'Expenses:Groceries',
			'Assets:Bank:Checking'
		]);
		expect(scheduleBackup).toHaveBeenCalled();
	});

	it('lists in date order regardless of insertion order', async () => {
		const store = newStore();
		await store.append(groceries('2025-08-20', 'C'));
		await store.append(groceries('2025-08-01', 'A'));
		await store.append(groceries('2025-08-10', 'B'));

		expect((await store.list()).map((s) => s.xact.payee)).toEqual(['A', 'B', 'C']);
	});

	it('keeps creation order for transactions on the same date', async () => {
		const store = newStore();
		await store.append(groceries('2025-08-10', 'first'));
		await store.append(groceries('2025-08-10', 'second'));
		await store.append(groceries('2025-08-10', 'third'));

		expect((await store.list()).map((s) => s.xact.payee)).toEqual(['first', 'second', 'third']);
	});

	it('rejects text without a transaction', async () => {
		const store = newStore();

		await expect(store.append('2025-01-01 open Assets:Cash')).rejects.toThrow(
			'No transaction found'
		);
		expect(await store.list()).toEqual([]);
	});
});

describe('update', () => {
	it('replaces the transaction keeping its id and origin', async () => {
		const store = newStore('device-A');
		const { id } = await store.append(groceries('2025-08-10', 'Old'));

		const updated = await store.update(id, groceries('2025-08-11', 'New', '10.00'));

		expect(updated.id).toBe(id);
		expect(updated.origin).toBe('device-A');
		const list = await store.list();
		expect(list).toHaveLength(1);
		expect(list[0].xact).toMatchObject({ date: '2025-08-11', payee: 'New' });
	});

	it('fails for an unknown id', async () => {
		await expect(newStore().update('nope', groceries('2025-08-10'))).rejects.toThrow(
			'Transaction nope not found'
		);
	});

	it('refuses to rewrite a record from a newer schema', async () => {
		const store = newStore();
		const { id } = await store.append(groceries('2025-08-10'));
		// Simulate a newer app having written the record.
		const records = store.doc.getMap<any>('xacts');
		records.set(id, { ...records.get(id), schemaVersion: XACT_SCHEMA_VERSION + 1 });

		await expect(store.update(id, groceries('2025-08-11'))).rejects.toThrow('newer app version');
		expect((await store.list())[0].xact.date).toBe('2025-08-10');
	});
});

describe('remove / clear', () => {
	it('removes only the given transaction', async () => {
		const store = newStore();
		const a = await store.append(groceries('2025-08-01', 'A'));
		await store.append(groceries('2025-08-02', 'B'));

		await store.remove(a.id);

		expect((await store.list()).map((s) => s.xact.payee)).toEqual(['B']);
	});

	it('ignores removing an unknown id', async () => {
		const store = newStore();
		await store.append(groceries('2025-08-01'));

		await store.remove('nope');

		expect(await store.list()).toHaveLength(1);
	});

	it('clears everything', async () => {
		const store = newStore();
		await store.append(groceries('2025-08-01'));
		await store.append(groceries('2025-08-02'));

		await store.clear();

		expect(await store.list()).toEqual([]);
		expect(await store.toBeancount()).toBe('');
	});
});

describe('toBeancount', () => {
	it('renders transactions in date order separated by blank lines', async () => {
		const store = newStore();
		await store.append(groceries('2025-08-20', 'Later'));
		await store.append(groceries('2025-08-01', 'Earlier'));

		const text = await store.toBeancount();

		expect(text.indexOf('Earlier')).toBeLessThan(text.indexOf('Later'));
		expect(text).toMatch(/\n\n2025-08-20/);
		expect(text.endsWith('\n')).toBe(true);
	});
});

describe('persistence', () => {
	it('reloads state from IndexedDB in a new store instance', async () => {
		const first = newStore('A', 'persisted-db');
		const { id } = await first.append(groceries('2025-08-10', 'Kept'));

		const second = newStore('A', 'persisted-db');
		const list = await second.list();

		expect(list.map((s) => [s.id, s.xact.payee])).toEqual([[id, 'Kept']]);
	});
});

describe('subscribe', () => {
	it('notifies on add, update, remove and clear, until unsubscribed', async () => {
		const store = newStore();
		await store.initialize();
		const callback = vi.fn();
		const unsubscribe = store.subscribe(callback);

		const { id } = await store.append(groceries('2025-08-10'));
		expect(callback).toHaveBeenCalledTimes(1);
		await store.update(id, groceries('2025-08-11'));
		expect(callback).toHaveBeenCalledTimes(2);
		await store.remove(id);
		expect(callback).toHaveBeenCalledTimes(3);
		await store.append(groceries('2025-08-12'));
		await store.clear();
		expect(callback).toHaveBeenCalledTimes(5);

		unsubscribe();
		await store.append(groceries('2025-08-13'));
		expect(callback).toHaveBeenCalledTimes(5);
	});
});

describe('multi-device merge', () => {
	it('merges another device state, keeping both sides records and origins', async () => {
		const a = newStore('A');
		const b = newStore('B');
		await a.append(groceries('2025-08-01', 'from A'));
		await b.append(groceries('2025-08-02', 'from B'));

		await a.importState(await b.exportState());

		const list = await a.list();
		expect(list.map((s) => [s.xact.payee, s.origin])).toEqual([
			['from A', 'A'],
			['from B', 'B']
		]);
		expect(await a.originCounts()).toEqual({ A: 1, B: 1 });
	});

	it('importing the same state twice is idempotent and schedules no extra backup', async () => {
		const a = newStore('A');
		const b = newStore('B');
		await b.append(groceries('2025-08-02'));
		const state = await b.exportState();
		await a.importState(state);
		vi.mocked(scheduleBackup).mockClear();

		await a.importState(state);

		expect(await a.list()).toHaveLength(1);
		expect(scheduleBackup).not.toHaveBeenCalled();
	});

	it('propagates deletions', async () => {
		const a = newStore('A');
		const b = newStore('B');
		const { id } = await a.append(groceries('2025-08-01'));
		await b.importState(await a.exportState());
		expect(await b.list()).toHaveLength(1);

		await a.remove(id);
		await b.importState(await a.exportState());

		expect(await b.list()).toEqual([]);
	});

	it('concurrent edits of one record resolve to the same value on both devices', async () => {
		const a = newStore('A');
		const b = newStore('B');
		const { id } = await a.append(groceries('2025-08-01', 'base'));
		await b.importState(await a.exportState());

		await a.update(id, groceries('2025-08-01', 'edit-A'));
		await b.update(id, groceries('2025-08-01', 'edit-B'));
		await a.importState(await b.exportState());
		await b.importState(await a.exportState());

		const [fromA] = await a.list();
		const [fromB] = await b.list();
		expect(fromA.xact.payee).toBe(fromB.xact.payee);
		expect(['edit-A', 'edit-B']).toContain(fromA.xact.payee);
		expect(await a.contentHash()).toBe(await b.contentHash());
	});

	it('contentHash differs while stores differ and matches once synced', async () => {
		const a = newStore('A');
		const b = newStore('B');
		await a.append(groceries('2025-08-01'));

		expect(await a.contentHash()).not.toBe(await b.contentHash());

		await b.importState(await a.exportState());
		expect(await a.contentHash()).toBe(await b.contentHash());
	});

	it('mergeAndDiff merges the peer state and returns only what the peer lacks', async () => {
		const a = newStore('A');
		const b = newStore('B');
		await a.append(groceries('2025-08-01', 'only A'));
		await b.append(groceries('2025-08-02', 'only B'));

		const diff = await a.mergeAndDiff(await b.exportState());
		await b.importState(diff);

		expect((await a.list()).map((s) => s.xact.payee)).toEqual(['only A', 'only B']);
		expect((await b.list()).map((s) => s.xact.payee)).toEqual(['only A', 'only B']);
		expect(await a.contentHash()).toBe(await b.contentHash());
	});
});
