/*
    Tests for commodityYield (isin/ticker linking, trailing yield, gain/loss)
    and the SecurityAnalyser wrapper around it. The ledger is a fake query
    function that records the BQL it was given.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/appService', () => ({
	default: { getDefaultCurrency: vi.fn(async () => 'EUR') }
}));

import {
	commoditiesFromDirectives,
	computeCommodityGainLoss,
	computeCommodityYield,
	resolveLinkedCurrencies,
	type CommodityDirective
} from '$lib/assetAllocation/commodityYield';
import { SecurityAnalyser } from '$lib/assetAllocation/securityAnalysis';
import { UserError } from '$lib/utils/errors';
import { mockQueryFn, queryResult } from '../helpers/queryMock';

const commodity = (currency: string, meta: Record<string, unknown> = {}): CommodityDirective => ({
	currency,
	meta
});

const VWCE = commodity('VWCE', { isin: 'IE00BK5BQT80' });
const VWCE_DE = commodity('VWCE.DE', { isin: 'IE00BK5BQT80' });
const VTI = commodity('VTI', { ticker: 'VTI' });
const VTI_US = commodity('VTI.US', { ticker: 'VTI' });
const GLD = commodity('GLD');
const all = [VWCE, VWCE_DE, VTI, VTI_US, GLD];

describe('commoditiesFromDirectives', () => {
	it('keeps only commodity directives, defaulting missing fields', () => {
		expect(
			commoditiesFromDirectives([
				{ type: 'open', account: 'Assets:Cash' },
				{ type: 'commodity', currency: 'VTI', meta: { isin: 'X' } },
				{ type: 'commodity' }
			])
		).toEqual([
			{ currency: 'VTI', meta: { isin: 'X' } },
			{ currency: '', meta: {} }
		]);
	});
});

describe('resolveLinkedCurrencies', () => {
	it('groups every commodity sharing the isin', () => {
		expect(resolveLinkedCurrencies(VWCE, all)).toEqual({
			currencies: ['VWCE', 'VWCE.DE'],
			matchedBy: 'isin',
			metaKey: 'isin',
			metaValue: 'IE00BK5BQT80'
		});
	});

	it('falls back to ticker, then to the bare currency code', () => {
		expect(resolveLinkedCurrencies(VTI, all)).toMatchObject({
			currencies: ['VTI', 'VTI.US'],
			matchedBy: 'ticker'
		});
		expect(resolveLinkedCurrencies(GLD, all)).toEqual({
			currencies: ['GLD'],
			matchedBy: 'symbol'
		});
	});

	it('prefers isin over ticker when both are declared', () => {
		const both = commodity('X', { isin: 'I', ticker: 'T' });

		expect(resolveLinkedCurrencies(both, [both]).matchedBy).toBe('isin');
	});

	it('uses the target itself when it is missing from the list', () => {
		expect(resolveLinkedCurrencies(VWCE, []).currencies).toEqual(['VWCE']);
	});

	it('ignores empty or non-string meta values', () => {
		expect(resolveLinkedCurrencies(commodity('A', { isin: '' }), []).matchedBy).toBe('symbol');
		expect(resolveLinkedCurrencies(commodity('A', { isin: 42 }), []).matchedBy).toBe('symbol');
	});
});

describe('computeCommodityYield', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 7, 15));
	});
	afterEach(() => vi.useRealTimers());

	/** Fake ledger answering the value query first-match, income query otherwise. */
	function ledger(value: string | null, income: string | null) {
		const seen: string[] = [];
		const fn = mockQueryFn([
			{
				match: (bql) => {
					seen.push(bql);
					return bql.includes('as value');
				},
				result: queryResult(['value'], value ? [[value]] : [])
			},
			{ match: () => true, result: queryResult(['income'], income ? [[income]] : []) }
		]);
		return { fn, seen };
	}

	it('computes trailing-12-month income over current value, flipping the credit sign', async () => {
		const { fn } = ledger('(1000.00 EUR)', '(-12.34 EUR)');

		const result = await computeCommodityYield(fn, GLD, all, 'EUR');

		expect(result).toMatchObject({
			income: 12.34,
			value: 1000,
			yieldPct: '1.23%',
			matchedBy: 'symbol',
			linkedCurrencies: ['GLD']
		});
	});

	it('links an isin across currency codes in both queries', async () => {
		const { fn, seen } = ledger('(100 EUR)', '(-1 EUR)');

		const result = await computeCommodityYield(fn, VWCE, all, 'EUR');

		expect(result.linkedCurrencies).toEqual(['VWCE', 'VWCE.DE']);
		expect(seen[0]).toContain("WHERE currency IN ('VWCE', 'VWCE.DE')");
		expect(seen[1]).toContain("ANY_META('isin') = 'IE00BK5BQT80'");
		expect(seen[1]).toContain("account ~ '^Income.*:(VWCE|VWCE.DE)$'");
	});

	it('limits income to the last twelve months', async () => {
		const { fn, seen } = ledger('(100 EUR)', '(-1 EUR)');

		await computeCommodityYield(fn, GLD, all, 'EUR');

		expect(seen[1]).toContain('date >= 2025-08-15');
	});

	it('uses only the account-name convention for an untagged commodity', async () => {
		const { fn, seen } = ledger('(100 EUR)', '(-1 EUR)');

		await computeCommodityYield(fn, GLD, all, 'EUR');

		expect(seen[1]).not.toContain('ANY_META');
		expect(seen[1]).toContain("account ~ '^Income.*:(GLD)$'");
	});

	it('is 0.00% for no holdings or no income', async () => {
		expect((await computeCommodityYield(ledger(null, null).fn, GLD, all, 'EUR')).yieldPct).toBe(
			'0.00%'
		);
		expect(
			(await computeCommodityYield(ledger('(100 EUR)', null).fn, GLD, all, 'EUR')).yieldPct
		).toBe('0.00%');
	});

	it('escapes single quotes in currency codes and meta values', async () => {
		const odd = commodity("O'NEIL", { isin: "A'B" });
		const { fn, seen } = ledger('(100 EUR)', '(-1 EUR)');

		await computeCommodityYield(fn, odd, [odd], 'EUR');

		expect(seen[0]).toContain("'O''NEIL'");
		expect(seen[1]).toContain("ANY_META('isin') = 'A''B'");
	});

	it('throws when the ledger reports errors', async () => {
		const fn = async () => ({ columns: [], rows: [], errors: [{ message: 'bad column' }] });

		await expect(computeCommodityYield(fn, GLD, all, 'EUR')).rejects.toThrow(
			'BQL query failed: bad column'
		);
	});
});

describe('computeCommodityGainLoss', () => {
	const gainLoss = (rows: unknown[][]) =>
		mockQueryFn([{ match: () => true, result: queryResult(['cost_basis', 'market_value'], rows) }]);

	it('reports unrealized gain and percentage', async () => {
		const result = await computeCommodityGainLoss(
			gainLoss([['(1000.00 EUR)', '(1250.00 EUR)']]),
			GLD,
			all,
			'EUR'
		);

		expect(result).toMatchObject({
			costBasis: 1000,
			marketValue: 1250,
			gainLoss: 250,
			gainLossPct: 25,
			summary: '250.00 EUR, 25.00%'
		});
	});

	it('shows losses with a minus sign', async () => {
		const result = await computeCommodityGainLoss(
			gainLoss([['(1000.00 EUR)', '(900.00 EUR)']]),
			GLD,
			all,
			'EUR'
		);

		expect(result.summary).toBe('-100.00 EUR, -10.00%');
	});

	it('avoids dividing by a zero cost basis', async () => {
		const result = await computeCommodityGainLoss(
			gainLoss([['(0 EUR)', '(50.00 EUR)']]),
			GLD,
			all,
			'EUR'
		);

		expect(result.gainLossPct).toBe(0);
		expect(result.gainLoss).toBe(50);
	});

	it("returns 'n/a' when there are no rows", async () => {
		const result = await computeCommodityGainLoss(gainLoss([]), GLD, all, 'EUR');

		expect(result).toMatchObject({ summary: 'n/a', gainLoss: 0 });
	});

	it('refuses several rows for one security', async () => {
		await expect(
			computeCommodityGainLoss(
				gainLoss([
					['(1 EUR)', '(1 EUR)'],
					['(2 EUR)', '(2 EUR)']
				]),
				GLD,
				all,
				'EUR'
			)
		).rejects.toThrow(UserError);
	});

	it('aggregates every linked currency code', async () => {
		const seen: string[] = [];
		const fn = async (bql: string) => {
			seen.push(bql);
			return queryResult(['a', 'b'], [['(1 EUR)', '(1 EUR)']]);
		};

		await computeCommodityGainLoss(fn, VWCE, all, 'EUR');

		expect(seen[0]).toContain("currency IN ('VWCE', 'VWCE.DE')");
	});
});

describe('SecurityAnalyser', () => {
	const fn = mockQueryFn([
		{
			match: (bql) => bql.includes('cost_basis'),
			result: queryResult(['cost_basis', 'market_value'], [['(100 EUR)', '(110 EUR)']])
		},
		{ match: (bql) => bql.includes('as value'), result: queryResult(['value'], [['(200 EUR)']]) },
		{ match: () => true, result: queryResult(['income'], [['(-10 EUR)']]) }
	]);

	it('gets the yield for a symbol in the default currency', async () => {
		const analyser = new SecurityAnalyser(fn, [GLD]);

		expect(await analyser.getYield('GLD')).toBe('5.00%');
		expect(analyser.currency).toBe('EUR');
	});

	it('gets the gain/loss summary, treating an unknown symbol as untagged', async () => {
		const analyser = new SecurityAnalyser(fn, []);

		expect(await analyser.getGainLoss('UNKNOWN')).toBe('10.00 EUR, 10.00%');
	});
});
