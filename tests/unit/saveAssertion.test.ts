import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Xact } from '#lib/data/model';

const store = vi.hoisted(() => ({
	appendMany: vi.fn(async () => {}),
	updateXact: vi.fn(async () => {})
}));
vi.mock('#lib/storage/xactStoreRegistry', () => ({ getXactStore: async () => store }));

import { saveBalanceAssertion } from '#lib/reconciliation/saveAssertion';

beforeEach(() => {
	store.appendMany.mockClear();
	store.updateXact.mockClear();
});

describe('saveBalanceAssertion', () => {
	it('appends a new assertion record to the working set', async () => {
		const tx = await saveBalanceAssertion({
			account: 'Assets:Bank',
			date: '2026-11-01',
			amount: 250.5,
			currency: ' eur '
		});
		expect(store.appendMany).toHaveBeenCalledWith([tx]);
		expect(store.updateXact).not.toHaveBeenCalled();
		expect(tx.date).toBe('2026-11-01');
		expect(tx.postings).toEqual([]);
		expect(tx.balanceAssertion).toEqual({
			account: 'Assets:Bank',
			amount: 250.5,
			currency: 'EUR'
		});
	});

	it('updates the existing record when editing', async () => {
		const existing = new Xact();
		const tx = await saveBalanceAssertion(
			{ account: 'Assets:Bank', date: '2026-12-01', amount: 1, currency: 'EUR' },
			{ id: 'abc', xact: existing }
		);
		expect(tx).toBe(existing);
		expect(store.updateXact).toHaveBeenCalledWith('abc', existing);
		expect(store.appendMany).not.toHaveBeenCalled();
	});
});
