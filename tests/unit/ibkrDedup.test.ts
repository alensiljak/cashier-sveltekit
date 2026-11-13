import { describe, expect, it } from 'vitest';
import { Posting, Xact } from '../../src/lib/data/model';
import { matchIbkr } from '../../src/lib/importers/ibkr/dedup';

function xact(date: string, postings: [string, number, string][]): Xact {
	const x = new Xact();
	x.date = date;
	x.postings = postings.map(([account, amount, currency]) => {
		const p = new Posting();
		p.account = account;
		p.amount = amount;
		p.currency = currency;
		return p;
	});
	return x;
}

const CASH = 'Assets:Investments:IB:Cash-EUR';
const INCOME = 'Income:Dividends:OPI';

describe('IBKR duplicate rule', () => {
	it('matches the same date and postings, in any order, amounts to 2 decimals', () => {
		const candidate = xact('2025-01-15', [
			[CASH, 1.349, 'EUR'],
			[INCOME, -1.349, 'EUR']
		]);
		const recorded = xact('2025-01-15', [
			[INCOME, -1.35, 'EUR'],
			[CASH, 1.35, 'EUR']
		]);
		const { results } = matchIbkr([candidate], [recorded]);
		expect(results[0].duplicateOf).toBe(recorded);
	});

	it('does not match another date, amount, account or currency', () => {
		const candidate = xact('2025-01-15', [
			[CASH, 1.35, 'EUR'],
			[INCOME, -1.35, 'EUR']
		]);
		const others = [
			xact('2025-01-16', [
				[CASH, 1.35, 'EUR'],
				[INCOME, -1.35, 'EUR']
			]),
			xact('2025-01-15', [
				[CASH, 1.36, 'EUR'],
				[INCOME, -1.36, 'EUR']
			]),
			xact('2025-01-15', [
				[CASH, 1.35, 'EUR'],
				['Income:Other', -1.35, 'EUR']
			]),
			xact('2025-01-15', [
				[CASH, 1.35, 'USD'],
				[INCOME, -1.35, 'USD']
			])
		];
		expect(matchIbkr([candidate], others).results[0].duplicateOf).toBeUndefined();
	});

	it('is one-to-one: two identical candidates need two recorded transactions', () => {
		const make = () =>
			xact('2025-01-15', [
				[CASH, 1, 'EUR'],
				[INCOME, -1, 'EUR']
			]);
		const recorded = make();
		const { results } = matchIbkr([make(), make()], [recorded]);
		expect(results.filter((r) => r.duplicateOf).length).toBe(1);
	});

	it('ignores Equity:Currency postings and never flags balance assertions', () => {
		const candidate = xact('2025-01-15', [[CASH, 5, 'EUR']]);
		const recorded = xact('2025-01-15', [
			[CASH, 5, 'EUR'],
			['Equity:Currency:Conversion', -5, 'EUR']
		]);
		expect(matchIbkr([candidate], [recorded]).results[0].duplicateOf).toBe(recorded);

		const assertion = xact('2025-01-16', []);
		assertion.balanceAssertion = { account: CASH, amount: 5, currency: 'EUR' };
		const sameAssertion = xact('2025-01-16', []);
		expect(matchIbkr([assertion], [sameAssertion]).results[0].duplicateOf).toBeUndefined();
	});

	it('reports recorded transactions in the date range that the file lacks', () => {
		const inFile = xact('2025-01-10', [[CASH, 1, 'EUR']]);
		const missing = xact('2025-01-12', [[CASH, 2, 'EUR']]);
		const outside = xact('2025-02-12', [[CASH, 3, 'EUR']]);
		const candidates = [
			xact('2025-01-10', [[CASH, 1, 'EUR']]),
			xact('2025-01-20', [[CASH, 9, 'EUR']])
		];
		const { unmatchedExisting } = matchIbkr(candidates, [inFile, missing, outside]);
		expect(unmatchedExisting).toEqual([missing]);
	});
});
