/*
    OpfsXactStore tests (the legacy file-based working set), with the OPFS
    layer replaced by an in-memory map and the real WASM parser doing the
    locating/sorting.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => new Map<string, string>());
vi.mock('$lib/utils/opfslib', () => ({
	readFile: vi.fn(async (name: string) => files.get(name)),
	saveFile: vi.fn(async (name: string, content: string) => {
		files.set(name, content);
	}),
	fileExists: vi.fn(async (name: string) => files.has(name))
}));
vi.mock('$lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));

import { scheduleBackup } from '$lib/services/webdavAutoBackupService';
import { OpfsXactStore } from '$lib/storage/opfsXactStore';

const FILE = 'cashier.bean';

const tx = (date: string, payee: string) => `${date} * "${payee}" "Food"
  Expenses:Groceries   10.00 EUR
  Assets:Bank:Checking`;

let store: OpfsXactStore;

beforeEach(() => {
	files.clear();
	vi.mocked(scheduleBackup).mockClear();
	store = new OpfsXactStore();
});

describe('initialisation', () => {
	it('is initialised once the file exists', async () => {
		expect(await store.isInitialized()).toBe(false);

		await store.initialize();

		expect(await store.isInitialized()).toBe(true);
		expect(files.get(FILE)).toBe('');
	});

	it('toBeancount creates the file empty on first use', async () => {
		expect(await store.toBeancount()).toBe('');
		expect(files.get(FILE)).toBe('');
	});
});

describe('append', () => {
	it('writes the transaction and returns it with an id', async () => {
		const stored = await store.append(tx('2025-08-10', 'Shop'));

		expect(stored.xact).toMatchObject({ date: '2025-08-10', payee: 'Shop' });
		expect(files.get(FILE)).toContain('2025-08-10 * "Shop"');
		expect(scheduleBackup).toHaveBeenCalled();
	});

	it('keeps the file sorted by date and separated by blank lines', async () => {
		await store.append(tx('2025-08-20', 'C'));
		await store.append(tx('2025-08-01', 'A'));
		await store.append(tx('2025-08-10', 'B'));

		const dates = [...files.get(FILE)!.matchAll(/^(\d{4}-\d\d-\d\d) \*/gm)].map((m) => m[1]);
		expect(dates).toEqual(['2025-08-01', '2025-08-10', '2025-08-20']);
		expect(files.get(FILE)).toMatch(/\n\n2025-08-10/);
	});

	it('returns the id of the transaction wherever sorting placed it', async () => {
		await store.append(tx('2025-08-20', 'Late'));

		const early = await store.append(tx('2025-08-01', 'Early'));

		expect(early.xact.payee).toBe('Early');
		const listed = await store.list();
		expect(listed.find((s) => s.id === early.id)?.xact.payee).toBe('Early');
	});
});

describe('list', () => {
	it('is empty for a missing or empty file', async () => {
		expect(await store.list()).toEqual([]);
		files.set(FILE, '');
		expect(await store.list()).toEqual([]);
	});

	it('lists every transaction with distinct ids', async () => {
		await store.append(tx('2025-08-01', 'A'));
		await store.append(tx('2025-08-02', 'B'));

		const listed = await store.list();

		expect(listed.map((s) => s.xact.payee)).toEqual(['A', 'B']);
		expect(new Set(listed.map((s) => s.id)).size).toBe(2);
	});
});

describe('update', () => {
	it('replaces the transaction in place', async () => {
		await store.append(tx('2025-08-01', 'A'));
		const b = await store.append(tx('2025-08-02', 'B'));

		const updated = await store.update(b.id, tx('2025-08-02', 'B edited'));

		expect(updated.xact.payee).toBe('B edited');
		expect((await store.list()).map((s) => s.xact.payee)).toEqual(['A', 'B edited']);
	});

	it('re-sorts when the date changes and returns the new id', async () => {
		const a = await store.append(tx('2025-08-01', 'A'));
		await store.append(tx('2025-08-02', 'B'));

		const moved = await store.update(a.id, tx('2025-08-30', 'A'));

		expect((await store.list()).map((s) => s.xact.payee)).toEqual(['B', 'A']);
		expect(moved.id).not.toBe(a.id);
		expect(moved.xact.payee).toBe('A');
	});

	it('fails for an id that matches no transaction', async () => {
		await store.append(tx('2025-08-01', 'A'));

		await expect(store.update('999', tx('2025-08-01', 'X'))).rejects.toThrow(
			'Could not locate directive'
		);
	});
});

describe('remove / clear', () => {
	it('removes the transaction and tidies the blank lines', async () => {
		await store.append(tx('2025-08-01', 'A'));
		const b = await store.append(tx('2025-08-02', 'B'));
		await store.append(tx('2025-08-03', 'C'));

		await store.remove(b.id);

		expect((await store.list()).map((s) => s.xact.payee)).toEqual(['A', 'C']);
		expect(files.get(FILE)).not.toMatch(/\n{3,}/);
	});

	it('fails for an unknown id', async () => {
		await store.append(tx('2025-08-01', 'A'));

		await expect(store.remove('999')).rejects.toThrow('Could not locate directive');
	});

	it('clear empties the file', async () => {
		await store.append(tx('2025-08-01', 'A'));

		await store.clear();

		expect(files.get(FILE)).toBe('');
		expect(await store.list()).toEqual([]);
	});
});

describe('subscribe', () => {
	it('notifies on every write until unsubscribed', async () => {
		const callback = vi.fn();
		const unsubscribe = store.subscribe(callback);

		const a = await store.append(tx('2025-08-01', 'A'));
		await store.update(a.id, tx('2025-08-01', 'A2'));
		const [{ id }] = await store.list();
		await store.remove(id);
		await store.clear();
		expect(callback).toHaveBeenCalledTimes(4);

		unsubscribe();
		await store.clear();
		expect(callback).toHaveBeenCalledTimes(4);
	});
});
