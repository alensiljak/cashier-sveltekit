// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
	createYahooPriceProvider,
	parseYahooPrice,
	toYahooSymbol,
	yahooChartUrl,
	yahooSymbolOf
} from '../../src/lib/services/prices/yahooPriceProvider';

function body(meta: Record<string, unknown>) {
	return { chart: { error: null, result: [{ meta }] } };
}

const VHY = body({
	currency: 'AUD',
	regularMarketPrice: 74.31,
	// 2026-11-17 23:30 UTC = 2026-11-18 10:30 in Sydney (+11h)
	regularMarketTime: Date.UTC(2026, 10, 17, 23, 30) / 1000,
	gmtoffset: 39600
});

describe('toYahooSymbol', () => {
	it('maps exchange namespaces to Yahoo suffixes', () => {
		expect(toYahooSymbol('ASX:VHY')).toBe('VHY.AX');
		expect(toYahooSymbol('XETRA:VWCE')).toBe('VWCE.DE');
		expect(toYahooSymbol('NASDAQ:AAPL')).toBe('AAPL');
		expect(toYahooSymbol('NYSEARCA:VTI')).toBe('VTI');
	});
	it('passes unknown namespaces through as suffixes and bare symbols verbatim', () => {
		expect(toYahooSymbol('TO:XEQT')).toBe('XEQT.TO');
		expect(toYahooSymbol('VHY.AX')).toBe('VHY.AX');
		expect(toYahooSymbol('AUDUSD=X')).toBe('AUDUSD=X');
	});
	it('url-encodes the symbol', () => {
		expect(yahooChartUrl('^GSPC')).toBe('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC');
	});
});

describe('parseYahooPrice', () => {
	it('uses the exchange-local date', () => {
		expect(parseYahooPrice(VHY)).toEqual({ date: '2026-11-18', rate: 74.31, quote: 'AUD' });
	});
	it('converts pence to pounds', () => {
		const price = parseYahooPrice(
			body({ currency: 'GBp', regularMarketPrice: 8250, regularMarketTime: 1763000000 })
		);
		expect(price.quote).toBe('GBP');
		expect(price.rate).toBeCloseTo(82.5);
	});
	it('throws on an error payload and on changed shapes', () => {
		expect(() =>
			parseYahooPrice({ chart: { error: { code: 'Not Found', description: 'No data found' } } })
		).toThrow(/No data found/);
		expect(() => parseYahooPrice({})).toThrow(/chart/);
		expect(() => parseYahooPrice({ chart: { error: null, result: [] } })).toThrow(/no result/);
		expect(() => parseYahooPrice(body({ currency: 'AUD', regularMarketTime: 1 }))).toThrow(
			/regularMarketPrice/
		);
		expect(() =>
			parseYahooPrice(body({ regularMarketPrice: 1, regularMarketTime: 1763000000 }))
		).toThrow(/currency/);
	});
});

describe('yahooSymbolOf', () => {
	const c = (price?: string) => ({ name: 'VHY', price });
	it('reads the symbol from a yahoo price tag', () => {
		expect(yahooSymbolOf(c('AUD:yahoo/ASX:VHY'))).toBe('VHY.AX');
		expect(yahooSymbolOf(c('AUD:aware/1, AUD:yahoo/AAPL'))).toBe('AAPL');
		expect(yahooSymbolOf(c('AUD:alens.pricedl.beanprice.yahoo/ASX:VHY'))).toBe('VHY.AX');
		expect(yahooSymbolOf(c('AUD:notyahoo/ASX:VHY'))).toBeUndefined();
	});
	it('ignores other sources, inverted and missing tags', () => {
		expect(yahooSymbolOf(c('AUD:aware/42000100'))).toBeUndefined();
		expect(yahooSymbolOf(c('USD:yahoo/^AUDUSD=X'))).toBeUndefined();
		expect(yahooSymbolOf(c())).toBeUndefined();
	});
});

describe('yahoo provider', () => {
	const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b });

	it('fetches covered commodities, reporting 404s as missing', async () => {
		const urls: string[] = [];
		const provider = createYahooPriceProvider(async (url) => {
			urls.push(url);
			return url.endsWith('VHY.AX') ? json(VHY) : json({}, 404);
		});
		const covered = await provider.resolveCovered!(
			[
				{ name: 'VHY', price: 'AUD:yahoo/ASX:VHY' },
				{ name: 'GONE', price: 'AUD:yahoo/ASX:GONE' },
				{ name: 'OTHER', price: 'AUD:aware/1' }
			],
			[]
		);
		expect(covered).toEqual(['VHY', 'GONE']);
		expect(provider.covers('OTHER')).toBe(false);

		const result = await provider.fetchLatest(['VHY', 'GONE']);
		expect(urls.sort()).toEqual([
			'https://query1.finance.yahoo.com/v8/finance/chart/GONE.AX',
			'https://query1.finance.yahoo.com/v8/finance/chart/VHY.AX'
		]);
		expect(result.quotes).toEqual([{ base: 'VHY', rate: 74.31, quote: 'AUD', date: '2026-11-18' }]);
		expect(result.missing).toEqual(['GONE']);
		expect(result.asOf).toBe('2026-11-18');
	});

	it('fails the run on a non-404 HTTP error', async () => {
		const provider = createYahooPriceProvider(async () => json({}, 429));
		await provider.resolveCovered!([{ name: 'VHY', price: 'AUD:yahoo/ASX:VHY' }], []);
		await expect(provider.fetchLatest(['VHY'])).rejects.toThrow(/HTTP 429/);
	});

	it('rejects inverted specs', () => {
		const provider = createYahooPriceProvider(async () => json({}));
		expect(
			provider.validateSpec!('X', { quote: 'USD', source: 'yahoo', symbol: 'AUDUSD=X', inverted: true })
		).toMatch(/inverted/);
		expect(
			provider.validateSpec!('X', { quote: 'AUD', source: 'yahoo', symbol: 'ASX:VHY', inverted: false })
		).toBeNull();
	});
});
