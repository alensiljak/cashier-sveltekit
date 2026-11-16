/*
    Tests for the Vanguard Australia securities provider: catalogue parsing
    (APIR/ticker → portId), NAV response validation, metadata matching, and
    fetchLatest against a stubbed proxy fetch. No network is touched.
*/
import { describe, expect, it, vi } from 'vitest';
import {
	createVanguardAuPriceProvider,
	parseVanguardCatalogue,
	parseVanguardPrice,
	type VanguardFetch
} from '#lib/services/prices/vanguardAuPriceProvider';

const catalogue = {
	statusCode: 200,
	data: [
		{ portId: '8105', tradingSymbols: { APIR: 'VAN0004AU', TICKER: null } },
		{ portId: '8207', tradingSymbols: { APIR: null, TICKER: 'VAF' } },
		{ portId: '8220', tradingSymbols: { APIR: null, TICKER: null } }
	]
};

function priceBody(price: number, date = '2026-11-16', currency = 'AUD') {
	return {
		statusCode: 200,
		data: [{ portId: '8105', navPrices: [{ asOfDate: date, currencyCode: currency, price }] }]
	};
}

function response(body: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body
	};
}

/** A fetch stub that serves the catalogue plus per-portId price bodies. */
function stubFetch(prices: Record<string, unknown>) {
	const calls: string[] = [];
	const fetchImpl: VanguardFetch = vi.fn(async (url: string) => {
		calls.push(url);
		if (url.endsWith('/funds/allfunds')) return response(catalogue);
		const portId = /\/fund\/([^/]+)\/prices/.exec(url)?.[1];
		if (portId && portId in prices) return response(prices[portId]);
		return response({ message: 'Not found' }, 404);
	});
	return { fetchImpl, calls };
}

describe('parseVanguardCatalogue', () => {
	it('lists products that carry an APIR or ticker, skipping the rest', () => {
		expect(parseVanguardCatalogue(catalogue)).toEqual([
			{ portId: '8105', label: 'VAN0004AU', apir: 'VAN0004AU' },
			{ portId: '8207', label: 'VAF', ticker: 'VAF' }
		]);
	});

	it('labels a product with its published name when there is one', () => {
		const body = {
			data: [{ portId: '8207', name: 'Vanguard Australian Fixed Interest', tradingSymbols: { TICKER: 'VAF' } }]
		};
		expect(parseVanguardCatalogue(body)[0].label).toBe('Vanguard Australian Fixed Interest');
	});

	it('rejects a response without a data array', () => {
		expect(() => parseVanguardCatalogue({})).toThrow(/no data array/);
		expect(() => parseVanguardCatalogue({ data: {} })).toThrow(/no data array/);
	});

	it('rejects entries without a valid port id', () => {
		expect(() => parseVanguardCatalogue({ data: [{ tradingSymbols: { TICKER: 'VAF' } }] })).toThrow(
			/portId/
		);
		expect(() =>
			parseVanguardCatalogue({ data: [{ portId: '../x', tradingSymbols: { TICKER: 'VAF' } }] })
		).toThrow(/portId/);
	});

	it('rejects a catalogue with no usable identifiers', () => {
		expect(() =>
			parseVanguardCatalogue({ data: [{ portId: '8105', tradingSymbols: {} }] })
		).toThrow(/no APIR or ticker/);
	});
});

describe('parseVanguardPrice', () => {
	it('returns the NAV with its own publication date and currency', () => {
		expect(parseVanguardPrice(priceBody(0.9736))).toEqual({
			date: '2026-11-16',
			rate: 0.9736,
			quote: 'AUD'
		});
	});

	it('picks the newest entry when several are returned', () => {
		const body = {
			data: [
				{
					navPrices: [
						{ asOfDate: '2026-11-13', currencyCode: 'AUD', price: 1 },
						{ asOfDate: '2026-11-16', currencyCode: 'AUD', price: 2 }
					]
				}
			]
		};
		expect(parseVanguardPrice(body)?.date).toBe('2026-11-16');
		expect(parseVanguardPrice(body)?.rate).toBe(2);
	});

	it('returns null when the fund has no NAV yet', () => {
		expect(parseVanguardPrice({ data: [] })).toBeNull();
		expect(parseVanguardPrice({ data: [{ navPrices: [] }] })).toBeNull();
		expect(parseVanguardPrice({ data: [{ navPrices: null }] })).toBeNull();
	});

	it('rejects malformed NAV entries', () => {
		const entry = { asOfDate: '2026-11-16', currencyCode: 'AUD', price: 1 };
		expect(() => parseVanguardPrice({ data: [{ navPrices: [{ ...entry, price: 0 }] }] })).toThrow(
			/price/
		);
		expect(() => parseVanguardPrice({ data: [{ navPrices: [{ ...entry, price: '1' }] }] })).toThrow(
			/price/
		);
		expect(() =>
			parseVanguardPrice({ data: [{ navPrices: [{ ...entry, asOfDate: '2026-11-32' }] }] })
		).toThrow(/date/);
		expect(() =>
			parseVanguardPrice({ data: [{ navPrices: [{ ...entry, currencyCode: '' }] }] })
		).toThrow(/currency/);
	});
});

/** The products a user would pick from the catalogue above. */
const selection = parseVanguardCatalogue(catalogue);

describe('Vanguard AU provider', () => {
	it('matches commodities to the selection by APIR or ticker metadata', async () => {
		const { fetchImpl, calls } = stubFetch({});
		const provider = createVanguardAuPriceProvider(fetchImpl);
		const covered = await provider.resolveCovered(
			[
				{ name: 'PROP', apir: 'VAN0004AU' },
				{ name: 'VAF', ticker: 'VAF' },
				{ name: 'VAN0004AU' },
				{ name: 'VTI', ticker: 'VTI' }
			],
			selection
		);
		expect(covered).toEqual(['PROP', 'VAF']);
		expect(calls).toEqual([]);
	});

	it('only covers products the user selected', async () => {
		const { fetchImpl } = stubFetch({});
		const provider = createVanguardAuPriceProvider(fetchImpl);
		const commodities = [
			{ name: 'PROP', apir: 'VAN0004AU' },
			{ name: 'VAF', ticker: 'VAF' }
		];
		expect(await provider.resolveCovered(commodities, [selection[1]])).toEqual(['VAF']);
		expect(await provider.resolveCovered(commodities, [])).toEqual([]);
	});

	it('does not match a commodity by name alone', async () => {
		const { fetchImpl } = stubFetch({});
		const provider = createVanguardAuPriceProvider(fetchImpl);
		expect(await provider.resolveCovered([{ name: 'VAN0004AU' }], selection)).toEqual([]);
	});

	it('rejects a symbol that was not resolved', async () => {
		const { fetchImpl } = stubFetch({});
		const provider = createVanguardAuPriceProvider(fetchImpl);
		await expect(provider.fetchLatest(['VAN0004AU'])).rejects.toThrow(
			/No Vanguard Australia product/
		);
	});

	it('downloads the catalogue only through fetchCatalogue', async () => {
		const { fetchImpl, calls } = stubFetch({});
		const provider = createVanguardAuPriceProvider(fetchImpl);
		expect(await provider.fetchCatalogue()).toEqual(selection);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatch(/\/funds\/allfunds$/);
	});

	it('fails fetchCatalogue on an HTTP error', async () => {
		const fetchImpl: VanguardFetch = vi.fn(async () => response({}, 500));
		const provider = createVanguardAuPriceProvider(fetchImpl);
		await expect(provider.fetchCatalogue()).rejects.toThrow(/HTTP 500/);
	});

	it('fetches each product and keeps per-quote dates', async () => {
		const { fetchImpl, calls } = stubFetch({
			'8105': priceBody(0.9736, '2026-11-16'),
			'8207': priceBody(45.21, '2026-11-13')
		});
		const provider = createVanguardAuPriceProvider(fetchImpl);
		await provider.resolveCovered(
			[
				{ name: 'PROP', apir: 'VAN0004AU' },
				{ name: 'VAF', ticker: 'VAF' }
			],
			selection
		);

		const fetched = await provider.fetchLatest(['PROP', 'VAF']);
		expect(fetched.source).toBe('vanguard-au');
		expect(fetched.asOf).toBe('2026-11-16');
		expect(fetched.missing).toEqual([]);
		expect(fetched.quotes).toEqual([
			{ base: 'PROP', rate: 0.9736, quote: 'AUD', date: '2026-11-16' },
			{ base: 'VAF', rate: 45.21, quote: 'AUD', date: '2026-11-13' }
		]);
		// One request per product — the catalogue is never fetched.
		expect(calls).toHaveLength(2);
		expect(calls.some((url) => url.endsWith('/funds/allfunds'))).toBe(false);
	});

	it('requests a single selected product on its own', async () => {
		const { fetchImpl, calls } = stubFetch({ '8105': priceBody(0.9736) });
		const provider = createVanguardAuPriceProvider(fetchImpl);
		await provider.resolveCovered([{ name: 'PROP', apir: 'VAN0004AU' }], selection);
		await provider.fetchLatest(['PROP']);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatch(/\/fund\/8105\/prices\?limit=1$/);
	});

	it('reports products without a NAV as missing', async () => {
		const { fetchImpl } = stubFetch({
			'8105': priceBody(0.9736),
			'8207': { data: [{ navPrices: [] }] }
		});
		const provider = createVanguardAuPriceProvider(fetchImpl);
		await provider.resolveCovered(
			[
				{ name: 'PROP', apir: 'VAN0004AU' },
				{ name: 'VAF', ticker: 'VAF' }
			],
			selection
		);
		const fetched = await provider.fetchLatest(['PROP', 'VAF']);
		expect(fetched.quotes.map((q) => q.base)).toEqual(['PROP']);
		expect(fetched.missing).toEqual(['VAF']);
	});

	it('throws when no requested product returns a price', async () => {
		const { fetchImpl } = stubFetch({ '8105': { data: [{ navPrices: [] }] } });
		const provider = createVanguardAuPriceProvider(fetchImpl);
		await provider.resolveCovered([{ name: 'PROP', apir: 'VAN0004AU' }], selection);
		await expect(provider.fetchLatest(['PROP'])).rejects.toThrow(/no prices/);
	});

	it('throws on an HTTP failure instead of writing a partial run', async () => {
		const { fetchImpl } = stubFetch({});
		const provider = createVanguardAuPriceProvider(fetchImpl);
		await provider.resolveCovered([{ name: 'PROP', apir: 'VAN0004AU' }], selection);
		await expect(provider.fetchLatest(['PROP'])).rejects.toThrow(/HTTP 404/);
	});
});
