/*
    loadInvestmentAccounts: builds the investment-account list from the ledger's
    grouped balances. Settings run against fake IndexedDB; the ledger is a fake
    query function.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/ledgerWorkerClient', () => ({ default: { query: vi.fn() } }));

import { loadInvestmentAccounts } from '$lib/services/accountsService';
import { DefaultCurrencyStore } from '$lib/data/mainStore';
import { SettingKeys, settings } from '$lib/settings';

const positions = (...units: [string, string][]) => ({
	positions: units.map(([number, currency]) => ({ units: { number, currency } }))
});

const result = (rows: unknown[][], errors: unknown[] = []) => ({
	columns: ['account', 'value', 'balances'],
	rows,
	errors
});

beforeEach(async () => {
	DefaultCurrencyStore.set('EUR');
	await settings.set(SettingKeys.rootInvestmentAccount, 'Assets:Investments');
});

describe('loadInvestmentAccounts', () => {
	it('maps rows to accounts with balances per currency and a current value', async () => {
		const query = vi.fn(async () =>
			result([
				['Assets:Investments:VTI', '1234.56 EUR', positions(['10.5', 'VTI'], ['0.25', 'VTI'])],
				['Assets:Investments:Cash', { number: '300', currency: 'EUR' }, positions(['300', 'EUR'])]
			])
		);

		const accounts = await loadInvestmentAccounts(query);

		expect(accounts.map((a) => a.name)).toEqual([
			'Assets:Investments:VTI',
			'Assets:Investments:Cash'
		]);
		// Decimal strings are added exactly: 10.5 + 0.25.
		expect(accounts[0].balances).toEqual({ VTI: 10.75 });
		expect(accounts[0]).toMatchObject({ currentValue: 1234.56, currentCurrency: 'EUR' });
		expect(accounts[1]).toMatchObject({ currentValue: 300, currentCurrency: 'EUR' });
	});

	it('parses a formatted value string with thousands separators and negatives', async () => {
		const query = vi.fn(async () =>
			result([
				['Assets:Investments:A', '1,234.50 EUR', positions(['1', 'A'])],
				['Assets:Investments:B', '-20.00 EUR', positions(['1', 'B'])]
			])
		);

		const [a, b] = await loadInvestmentAccounts(query);

		expect(a.currentValue).toBe(1234.5);
		expect(b.currentValue).toBe(-20);
	});

	it('filters on the configured root account and converts to the default currency', async () => {
		DefaultCurrencyStore.set('USD');
		const query = vi.fn(async () => result([]));

		await loadInvestmentAccounts(query);

		const bql = (query.mock.calls[0] as unknown as [string])[0];
		expect(bql).toContain("account ~ '^Assets:Investments'");
		expect(bql).toContain("str(value(sum(position), 'USD')) as value");
	});

	it('uses the default currency in the non-zero check, not a hard-coded one', async () => {
		DefaultCurrencyStore.set('USD');
		const query = vi.fn(async () => result([]));

		await loadInvestmentAccounts(query);

		const bql = (query.mock.calls[0] as unknown as [string])[0];
		expect(bql).toContain("HAVING number(value(sum(position), 'USD')) != 0");
		expect(bql).not.toContain("'EUR'");
	});

	it('fails when the root investment account is not configured', async () => {
		await settings.set(SettingKeys.rootInvestmentAccount, '');

		await expect(loadInvestmentAccounts(vi.fn())).rejects.toThrow(
			'Root investment account not set'
		);
	});

	it('surfaces ledger query errors', async () => {
		const query = vi.fn(async () => result([], [{ message: 'boom' }, { message: 'bang' }]));

		await expect(loadInvestmentAccounts(query)).rejects.toThrow('boom; bang');
	});
});
