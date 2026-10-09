/*
    Resetting a CRDT store: the document (and every tombstone in it) is replaced by a fresh one,
    and other devices follow without bringing deleted records back.
*/
import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/utils/notifier', () => ({ default: { warning: vi.fn() } }));
vi.mock('#lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));

import notifier from '#lib/utils/notifier';
import { CrdtXactStore } from '#lib/storage/crdtXactStore';

let counter = 0;
const newStore = (origin: string) =>
	new CrdtXactStore(`test-reset-${++counter}`, async () => origin);

const xact = (date: string, payee: string) => `${date} * "${payee}" "Food"
  Expenses:Groceries   10.00 EUR
  Assets:Bank:Checking
`;

/** Both stores end up with each other's state. */
async function sync(a: CrdtXactStore, b: CrdtXactStore) {
	await a.importState(await b.exportState());
	await b.importState(await a.exportState());
}

const payees = async (s: CrdtXactStore) => (await s.list()).map((x) => x.xact.payee).sort();

async function emptied(store: CrdtXactStore) {
	for (const { id } of await store.list()) await store.remove(id);
}

describe('reset', () => {
	it('refuses while records remain', async () => {
		const store = newStore('A');
		await store.append(xact('2025-01-01', 'Shop'));

		await expect(store.reset()).rejects.toThrow(/Delete all records/);
		expect(await payees(store)).toEqual(['Shop']);
	});

	it('drops the tombstones', async () => {
		const store = newStore('A');
		for (let i = 0; i < 20; i++) await store.append(xact('2025-01-01', `Shop ${i}`));
		await emptied(store);
		const before = (await store.exportState()).length;

		await store.reset();

		expect(await store.list()).toEqual([]);
		expect((await store.exportState()).length).toBeLessThan(before / 2);
		expect((await store.exportState()).length).toBeLessThan(150);
	});

	it('keeps the store usable and persisted', async () => {
		const name = `test-reset-persist-${++counter}`;
		const store = new CrdtXactStore(name, async () => 'A');
		await store.initialize();
		await store.reset();
		await store.append(xact('2025-01-01', 'After'));

		expect(await payees(new CrdtXactStore(name, async () => 'A'))).toEqual(['After']);
	});

	it('keeps subscribers and update handlers working across the swap', async () => {
		const store = newStore('A');
		await store.initialize();
		const changed = vi.fn();
		const updated = vi.fn();
		store.subscribe(changed);
		store.onUpdate(updated);

		await store.reset();
		changed.mockClear();
		updated.mockClear();
		await store.append(xact('2025-01-01', 'New'));

		expect(changed).toHaveBeenCalled();
		expect(updated).toHaveBeenCalled();
	});
});

describe('reset propagation', () => {
	it('a synced device follows the reset and the deleted records stay gone', async () => {
		const a = newStore('A');
		const b = newStore('B');
		await a.append(xact('2025-01-01', 'Old 1'));
		await a.append(xact('2025-01-02', 'Old 2'));
		await sync(a, b);
		await emptied(a);
		await sync(a, b);
		expect(await payees(b)).toEqual([]);

		await a.reset();
		await sync(a, b);

		expect(await payees(a)).toEqual([]);
		expect(await payees(b)).toEqual([]);
		expect((await b.exportState()).length).toBe((await a.exportState()).length);
	});

	it('does not take a stale device back in', async () => {
		const a = newStore('A');
		const b = newStore('B');
		await a.append(xact('2025-01-01', 'Archived'));
		await sync(a, b);
		const staleB = await b.exportState();

		await emptied(a);
		await a.reset();
		await a.importState(staleB);

		expect(await payees(a)).toEqual([]);
	});

	it('ignores a stale incremental update too', async () => {
		const a = newStore('A');
		const b = newStore('B');
		await a.initialize();
		const updates: Uint8Array[] = [];
		b.onUpdate((u) => updates.push(u));
		await b.append(xact('2025-01-03', 'Archived by B'));
		// A saw this record, archived it and reset; replaying the update must not bring it back.
		await sync(a, b);
		expect(await payees(a)).toEqual(['Archived by B']);
		await emptied(a);
		await a.reset();
		for (const u of updates) await a.importState(u);

		expect(await payees(a)).toEqual([]);
	});

	it('keeps records the resetting device never saw, and says so', async () => {
		const a = newStore('A');
		const b = newStore('B');
		await a.append(xact('2025-01-01', 'Archived'));
		await sync(a, b);
		await b.append(xact('2025-01-05', 'Offline entry'));

		await emptied(a);
		await a.reset();
		await b.importState(await a.exportState());

		expect(await payees(b)).toEqual(['Offline entry']);
		expect(notifier.warning).toHaveBeenCalled();

		// The kept record then reaches A, and nothing archived returns.
		await a.importState(await b.exportState());
		expect(await payees(a)).toEqual(['Offline entry']);
	});

	it('survives a second reset', async () => {
		const a = newStore('A');
		const b = newStore('B');
		await a.append(xact('2025-01-01', 'One'));
		await sync(a, b);
		const staleB = await b.exportState();
		await emptied(a);
		await a.reset();
		await sync(a, b);

		await b.append(xact('2025-02-01', 'Two'));
		await sync(a, b);
		await emptied(b);
		await b.reset();
		await sync(a, b);

		await a.importState(staleB);
		expect(await payees(a)).toEqual([]);
		expect(await payees(b)).toEqual([]);
	});
});
