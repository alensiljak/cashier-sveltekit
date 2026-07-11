import { describe, it, expect } from 'vitest';
import { getSecuritiesList, type SecurityListItem } from '$lib/assetAllocation/securityReturns';
import type { CommodityDirective, QueryFn } from '$lib/assetAllocation/commodityYield';

const directives: CommodityDirective[] = [
	{ currency: 'VTI', meta: { name: 'Vanguard Total Stock Market ETF' } },
	{ currency: 'BND', meta: { name: 'Vanguard Total Bond Market ETF' } },
	{ currency: 'GLD', meta: { name: 'SPDR Gold Shares' } }
];

// Builds a mock ledger query function returning canned rows based on the BQL.
function mockQueryFn(): QueryFn {
	return async (bql: string) => {
		if (bql.includes('FROM prices')) {
			return {
				columns: ['date', 'currency', 'amount'],
				rows: [
					['2026-07-01', 'VTI', { number: '221.00', currency: 'EUR' }],
					['2026-07-01', 'BND', { number: '71.45', currency: 'EUR' }],
					['2026-07-01', 'GLD', { number: '195.00', currency: 'EUR' }]
				],
				errors: []
			};
		}

		// Register-style query for realized gain of closed securities.
		if (bql.includes('number(units(position)) as units')) {
			return {
				columns: ['date', 'symbol', 'units', 'cost_number', 'value'],
				rows: [
					['2026-07-11', 'GLD', 5, 180, { number: '900.00', currency: 'EUR' }],
					['2026-07-11', 'GLD', -5, 180, { number: '-975.00', currency: 'EUR' }]
				],
				errors: []
			};
		}

		// Lots query (active or closed, distinguished by the HAVING clause).
		const columns = [
			'date',
			'account',
			'symbol',
			'quantity',
			'price',
			'cost',
			'value',
			'converted_value'
		];
		if (bql.includes('<= 0')) {
			// Closed lots only.
			return {
				columns,
				rows: [
					[
						'2026-07-11',
						'Assets:Investments:Brokerage:GLD',
						'GLD',
						-5,
						180,
						'900.00 EUR',
						'0.00 EUR',
						'0.00 EUR'
					]
				],
				errors: []
			};
		}
		// Active open lots.
		return {
			columns,
			rows: [
				[
					'2025-08-05',
					'Assets:Investments:Brokerage:VTI',
					'VTI',
					7,
					200,
					'1400.00 EUR',
					'1500.00 EUR',
					'1500.00 EUR'
				],
				[
					'2025-09-05',
					'Assets:Investments:Brokerage:BND',
					'BND',
					16,
					70.2,
					'1128.00 EUR',
					'1140.00 EUR',
					'1140.00 EUR'
				]
			],
			errors: []
		};
	};
}

function find(items: SecurityListItem[], symbol: string) {
	return items.find((i) => i.symbol === symbol);
}

describe('getSecuritiesList', () => {
	it('lists only active securities by default', async () => {
		const items = await getSecuritiesList(mockQueryFn(), directives, 'EUR', false);
		expect(items.map((i) => i.symbol)).toEqual(['BND', 'VTI']);

		const vti = find(items, 'VTI')!;
		expect(vti.marketValue).toBe(1500);
		expect(vti.costBasis).toBe(1400);
		expect(vti.gainLoss).toBe(100);
		expect(vti.gainLossPct).toBeCloseTo(7.1428, 3);
		expect(vti.closed).toBe(false);
		expect(vti.name).toBe('Vanguard Total Stock Market ETF');
		expect(vti.lastPrice).toBe(221);
	});

	it('appends fully-closed securities with realized gain when includeClosed is true', async () => {
		const items = await getSecuritiesList(mockQueryFn(), directives, 'EUR', true);
		expect(items.map((i) => i.symbol)).toContain('GLD');

		const gld = find(items, 'GLD')!;
		expect(gld.closed).toBe(true);
		expect(gld.marketValue).toBe(0);
		expect(gld.costBasis).toBe(900); // amount invested
		expect(gld.gainLoss).toBe(75); // realized: (195 - 180) * 5
		expect(gld.gainLossPct).toBeCloseTo(8.3333, 3);
	});

	it('excludes GLD when includeClosed is false', async () => {
		const items = await getSecuritiesList(mockQueryFn(), directives, 'EUR', false);
		expect(items.find((i) => i.symbol === 'GLD')).toBeUndefined();
	});
});
