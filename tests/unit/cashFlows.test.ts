import { Account } from '$lib/data/model';
import {
	buildFullFlowSeries,
	extractAllGroupFlows,
	extractGroupFlows,
	marketValuesForGroups,
	transactionFlowsForGroups,
	type QueryFn
} from '$lib/portfolioReturns/cashFlows';
import type { InvestmentGroup } from '$lib/portfolioReturns/investmentGroups';
import { describe, expect, it } from 'vitest';

function group(name: string, symbols: string[], accountNames: string[]): InvestmentGroup {
	return { name, symbols, accounts: accountNames.map((n) => new Account(n)) };
}

const VTI = group('Allocation:Equity:US', ['VTI'], ['Assets:Investments:Broker:VTI']);
const BND = group('Allocation:Bonds', ['BND'], ['Assets:Investments:Broker:BND']);

interface QueryResult {
	columns: string[];
	rows: unknown[][];
	errors: unknown[];
}

/** Builds a mock QueryFn from a list of { match, result } rules, tried in order. */
function mockQueryFn(rules: { match: (bql: string) => boolean; result: QueryResult }[]): QueryFn {
	return async (bql: string) => {
		const rule = rules.find((r) => r.match(bql));
		if (!rule) throw new Error(`Unmatched BQL in test: ${bql}`);
		return rule.result;
	};
}

const noAccountValues: QueryResult = { columns: ['account', 'value'], rows: [], errors: [] };
const noIds: QueryResult = { columns: ['id', 'account'], rows: [], errors: [] };

const isOpeningValueQuery = (bql: string) =>
	bql.includes('GROUP BY account') && bql.includes('2024-12-31');
const isClosingValueQuery = (bql: string) =>
	bql.includes('GROUP BY account') && bql.includes('2025-12-31');
const isIdsQuery = (bql: string) => bql.startsWith('SELECT id, account');
const isPostingsQuery = (bql: string) => bql.startsWith('SELECT id, date, account');

describe('extractAllGroupFlows', () => {
	it('returns empty results for groups with no accounts', async () => {
		const empty = group('Allocation:Empty', [], []);
		const queryFn = mockQueryFn([]);
		const results = await extractAllGroupFlows(queryFn, [empty], 'EUR', '2025-01-01', '2025-12-31');
		expect(results.get('Allocation:Empty')).toEqual({
			flows: [],
			openingValue: 0,
			closingValue: 0,
			conversionWarnings: []
		});
	});

	it('emits opening/closing synthetic flows from market value, and skips zero-valued ones', async () => {
		const queryFn = mockQueryFn([
			{
				match: isOpeningValueQuery,
				result: {
					columns: ['account', 'value'],
					rows: [['Assets:Investments:Broker:VTI', '1000.00 EUR']],
					errors: []
				}
			},
			{
				match: isClosingValueQuery,
				result: {
					columns: ['account', 'value'],
					rows: [['Assets:Investments:Broker:VTI', '1500.00 EUR']],
					errors: []
				}
			},
			{ match: isIdsQuery, result: noIds }
		]);

		const results = await extractAllGroupFlows(queryFn, [VTI], 'EUR', '2025-01-01', '2025-12-31');
		const { flows, openingValue, closingValue, conversionWarnings } = results.get(VTI.name)!;

		expect(conversionWarnings).toEqual([]);
		expect(openingValue).toBe(1000);
		expect(closingValue).toBe(1500);
		expect(flows).toEqual([
			{ date: new Date(2025, 0, 1), amount: -1000 },
			{ date: new Date(2025, 11, 31), amount: 1500 }
		]);
	});

	it('treats a buy against shared broker cash as a full external flow, not a netted-out internal move', async () => {
		const queryFn = mockQueryFn([
			{ match: isOpeningValueQuery, result: noAccountValues },
			{ match: isClosingValueQuery, result: noAccountValues },
			{
				match: isIdsQuery,
				result: {
					columns: ['id', 'account'],
					rows: [['32', 'Assets:Investments:Broker:VTI']],
					errors: []
				}
			},
			{
				match: isPostingsQuery,
				result: {
					columns: ['id', 'date', 'account', 'currency', 'converted'],
					rows: [
						// Bought VTI funded from the broker's single shared cash account,
						// which also funds every other security at this broker.
						['32', '2025-03-01', 'Assets:Investments:Broker:VTI', 'VTI', '1000.00 EUR'],
						['32', '2025-03-01', 'Assets:Investments:Broker:Cash', 'EUR', '-1000.00 EUR']
					],
					errors: []
				}
			}
		]);

		const results = await extractAllGroupFlows(queryFn, [VTI], 'EUR', '2025-01-01', '2025-12-31');
		const { flows, conversionWarnings } = results.get(VTI.name)!;

		expect(conversionWarnings).toEqual([]);
		expect(flows).toEqual([{ date: new Date(2025, 2, 1), amount: -1000 }]);
	});

	it('sums multiple external legs of the same transaction into one flow', async () => {
		const queryFn = mockQueryFn([
			{ match: isOpeningValueQuery, result: noAccountValues },
			{ match: isClosingValueQuery, result: noAccountValues },
			{
				match: isIdsQuery,
				result: {
					columns: ['id', 'account'],
					rows: [['32', 'Assets:Investments:Broker:VTI']],
					errors: []
				}
			},
			{
				match: isPostingsQuery,
				result: {
					columns: ['id', 'date', 'account', 'currency', 'converted'],
					rows: [
						['32', '2025-03-01', 'Assets:Investments:Broker:VTI', 'VTI', '990.00 EUR'],
						['32', '2025-03-01', 'Expenses:Fees', 'EUR', '10.00 EUR'],
						['32', '2025-03-01', 'Assets:Investments:Broker:Cash', 'EUR', '-1000.00 EUR']
					],
					errors: []
				}
			}
		]);

		const results = await extractAllGroupFlows(queryFn, [VTI], 'EUR', '2025-01-01', '2025-12-31');
		// Expenses:Fees is internal (folded into market value); only the cash leg is external.
		expect(results.get(VTI.name)!.flows).toEqual([{ date: new Date(2025, 2, 1), amount: -1000 }]);
	});

	it('treats dividends into Income accounts as internal, not an external flow', async () => {
		const queryFn = mockQueryFn([
			{ match: isOpeningValueQuery, result: noAccountValues },
			{ match: isClosingValueQuery, result: noAccountValues },
			{
				match: isIdsQuery,
				result: {
					columns: ['id', 'account'],
					rows: [['32', 'Assets:Investments:Broker:VTI']],
					errors: []
				}
			},
			{
				match: isPostingsQuery,
				result: {
					columns: ['id', 'date', 'account', 'currency', 'converted'],
					rows: [
						['32', '2025-06-15', 'Assets:Investments:Broker:VTI', 'VTI', '50.00 EUR'],
						['32', '2025-06-15', 'Income:Dividends:VTI', 'EUR', '-50.00 EUR']
					],
					errors: []
				}
			}
		]);

		const results = await extractAllGroupFlows(queryFn, [VTI], 'EUR', '2025-01-01', '2025-12-31');
		expect(results.get(VTI.name)!.flows).toEqual([]);
	});

	it("treats a rebalance into another group's account as an external flow for both", async () => {
		const queryFn = mockQueryFn([
			{ match: isOpeningValueQuery, result: noAccountValues },
			{ match: isClosingValueQuery, result: noAccountValues },
			{
				match: isIdsQuery,
				result: {
					columns: ['id', 'account'],
					rows: [
						['32', 'Assets:Investments:Broker:VTI'],
						['32', 'Assets:Investments:Broker:BND']
					],
					errors: []
				}
			},
			{
				match: isPostingsQuery,
				result: {
					columns: ['id', 'date', 'account', 'currency', 'converted'],
					rows: [
						// Sold VTI, bought BND directly — no cash leg at all.
						['32', '2025-04-01', 'Assets:Investments:Broker:VTI', 'VTI', '-500.00 EUR'],
						['32', '2025-04-01', 'Assets:Investments:Broker:BND', 'BND', '500.00 EUR']
					],
					errors: []
				}
			}
		]);

		const results = await extractAllGroupFlows(
			queryFn,
			[VTI, BND],
			'EUR',
			'2025-01-01',
			'2025-12-31'
		);
		expect(results.get(VTI.name)!.flows).toEqual([{ date: new Date(2025, 3, 1), amount: 500 }]);
		expect(results.get(BND.name)!.flows).toEqual([{ date: new Date(2025, 3, 1), amount: -500 }]);
	});

	it('excludes an unconverted amount from the flow instead of mixing currencies, but still warns', async () => {
		const queryFn = mockQueryFn([
			{
				match: isOpeningValueQuery,
				result: {
					columns: ['account', 'value'],
					rows: [['Assets:Investments:Broker:VTI', '1000.00 USD']], // no EUR price
					errors: []
				}
			},
			{ match: isClosingValueQuery, result: noAccountValues },
			{ match: isIdsQuery, result: noIds }
		]);

		const results = await extractAllGroupFlows(queryFn, [VTI], 'EUR', '2025-01-01', '2025-12-31');
		const { flows, openingValue, conversionWarnings } = results.get(VTI.name)!;

		expect(conversionWarnings).toEqual(['VTI: no price to EUR (got USD)']);
		// The unconverted USD amount must NOT be summed as if it were EUR — that silently
		// corrupts the NPV (this is what previously produced wildly wrong IRRs). Callers check
		// conversionWarnings and treat the group's IRR as unavailable instead.
		expect(openingValue).toBe(0);
		expect(flows).toEqual([]);
	});

	it('propagates BQL errors', async () => {
		const queryFn = mockQueryFn([
			{
				match: () => true,
				result: { columns: [], rows: [], errors: [{ message: 'bad query' }] }
			}
		]);

		await expect(
			extractAllGroupFlows(queryFn, [VTI], 'EUR', '2025-01-01', '2025-12-31')
		).rejects.toThrow('bad query');
	});
});

describe('extractGroupFlows', () => {
	it('delegates to extractAllGroupFlows for a single group', async () => {
		const queryFn = mockQueryFn([
			{
				match: isOpeningValueQuery,
				result: {
					columns: ['account', 'value'],
					rows: [['Assets:Investments:Broker:VTI', '1000.00 EUR']],
					errors: []
				}
			},
			{ match: isClosingValueQuery, result: noAccountValues },
			{ match: isIdsQuery, result: noIds }
		]);

		const { flows, openingValue } = await extractGroupFlows(
			queryFn,
			VTI,
			'EUR',
			'2025-01-01',
			'2025-12-31'
		);
		expect(openingValue).toBe(1000);
		expect(flows).toEqual([{ date: new Date(2025, 0, 1), amount: -1000 }]);
	});
});

describe('marketValuesForGroups', () => {
	it('resolves independently of transaction flows — only issues the 2 value queries', async () => {
		const queryFn = mockQueryFn([
			{
				match: isOpeningValueQuery,
				result: {
					columns: ['account', 'value'],
					rows: [['Assets:Investments:Broker:VTI', '1000.00 EUR']],
					errors: []
				}
			},
			{
				match: isClosingValueQuery,
				result: {
					columns: ['account', 'value'],
					rows: [['Assets:Investments:Broker:VTI', '1500.00 EUR']],
					errors: []
				}
			}
			// No ids/postings rule registered — would throw "Unmatched BQL" if this phase
			// tried to query transaction flows.
		]);

		const results = await marketValuesForGroups(queryFn, [VTI], 'EUR', '2025-01-01', '2025-12-31');
		expect(results.get(VTI.name)).toEqual({
			openingValue: 1000,
			closingValue: 1500,
			conversionWarnings: []
		});
	});
});

describe('transactionFlowsForGroups', () => {
	it('resolves independently of market values — only issues the id/postings queries', async () => {
		const queryFn = mockQueryFn([
			{
				match: isIdsQuery,
				result: {
					columns: ['id', 'account'],
					rows: [['32', 'Assets:Investments:Broker:VTI']],
					errors: []
				}
			},
			{
				match: isPostingsQuery,
				result: {
					columns: ['id', 'date', 'account', 'currency', 'converted'],
					rows: [
						['32', '2025-03-01', 'Assets:Investments:Broker:VTI', 'VTI', '1000.00 EUR'],
						['32', '2025-03-01', 'Assets:Investments:Broker:Cash', 'EUR', '-1000.00 EUR']
					],
					errors: []
				}
			}
			// No opening/closing value rule registered — would throw if this phase tried to
			// query market values.
		]);

		const results = await transactionFlowsForGroups(
			queryFn,
			[VTI],
			'EUR',
			'2025-01-01',
			'2025-12-31'
		);
		expect(results.get(VTI.name)).toEqual({
			flows: [{ date: new Date(2025, 2, 1), amount: -1000 }],
			conversionWarnings: []
		});
	});
});

describe('buildFullFlowSeries', () => {
	it('merges transaction flows with synthetic opening/closing entries, sorted by date', () => {
		const transactionFlows = [{ date: new Date(2025, 2, 1), amount: -1000 }];
		const flows = buildFullFlowSeries(transactionFlows, 500, 2000, '2025-01-01', '2025-12-31');
		expect(flows).toEqual([
			{ date: new Date(2025, 0, 1), amount: -500 },
			{ date: new Date(2025, 2, 1), amount: -1000 },
			{ date: new Date(2025, 11, 31), amount: 2000 }
		]);
	});

	it('omits zero-valued opening/closing entries', () => {
		const flows = buildFullFlowSeries([], 0, 0, '2025-01-01', '2025-12-31');
		expect(flows).toEqual([]);
	});
});
