// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
	awareOptionId,
	createAwarePriceProvider,
	parseAwareCatalogue,
	parseAwareOptions
} from '../../src/lib/services/prices/awarePriceProvider';
import { handleProxyRequest, UPSTREAM_KEY_HEADER, type FetchLike } from '../../worker/proxy';

const BODY = {
	effectiveDate: '2026-11-13',
	investmentOptions: [
		{
			investmentOptionId: '42000100',
			investmentOptionName: 'High Growth',
			sortOrder: 1,
			unitPrices: [
				{ date: '2026-11-12', value: 12.903773 },
				{ date: '2026-11-13', value: 12.881781 },
				{ date: '2026-11-11', value: 12.905565 }
			]
		},
		{
			investmentOptionId: '40000062',
			investmentOptionName: ' Conservative ',
			unitPrices: [{ date: '2026-11-13', value: 2.181164 }]
		},
		{ investmentOptionId: '42000096', investmentOptionName: 'Cash', unitPrices: [] }
	]
};

describe('parseAwareOptions', () => {
	it('picks the newest price per option regardless of order', () => {
		const options = parseAwareOptions(BODY);
		expect(options.map((o) => [o.id, o.name, o.latest])).toEqual([
			['42000100', 'High Growth', { date: '2026-11-13', rate: 12.881781 }],
			['40000062', 'Conservative', { date: '2026-11-13', rate: 2.181164 }],
			['42000096', 'Cash', null]
		]);
	});

	it('builds the catalogue from ids and names', () => {
		expect(parseAwareCatalogue(BODY)[0]).toEqual({ portId: '42000100', label: 'High Growth' });
	});

	it('throws on a changed shape', () => {
		expect(() => parseAwareOptions([])).toThrow(/not an object/);
		expect(() => parseAwareOptions({})).toThrow(/investmentOptions/);
		expect(() => parseAwareOptions({ investmentOptions: [] })).toThrow(/no investment options/);
		expect(() => parseAwareOptions({ investmentOptions: [{ investmentOptionName: 'x' }] })).toThrow(
			/investmentOptionId/
		);
		expect(() =>
			parseAwareOptions({
				investmentOptions: [{ investmentOptionId: '1', unitPrices: [{ date: '2026-11-13', value: 0 }] }]
			})
		).toThrow(/valid value/);
		expect(() =>
			parseAwareOptions({
				investmentOptions: [{ investmentOptionId: '1', unitPrices: [{ date: '13/11/2026', value: 1 }] }]
			})
		).toThrow(/valid date/);
	});
});

describe('awareOptionId', () => {
	const c = (price?: string) => ({ name: 'X', price });
	it('reads the id from an aware price tag', () => {
		expect(awareOptionId(c('AUD:aware/42000100'))).toBe('42000100');
		expect(awareOptionId(c('AUD:ecbrates/EUR, AUD:aware/42000100'))).toBe('42000100');
	});
	it('ignores other sources, names, inverted and missing tags', () => {
		expect(awareOptionId(c('AUD:vanguard/8105'))).toBeUndefined();
		expect(awareOptionId(c('AUD:aware/HighGrowth'))).toBeUndefined();
		expect(awareOptionId(c('AUD:aware/^42000100'))).toBeUndefined();
		expect(awareOptionId(c())).toBeUndefined();
	});
});

describe('provider', () => {
	const ok = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => BODY }));

	it('serves only commodities tagged for it and fetches their latest prices', async () => {
		const fetchImpl = ok();
		const provider = createAwarePriceProvider(fetchImpl, async () => 'key');
		const covered = await provider.resolveCovered!(
			[
				{ name: 'AWARE_HG', price: 'AUD:aware/42000100' },
				{ name: 'AWARE_CASH', price: 'AUD:aware/42000096' },
				{ name: 'AWARE_GONE', price: 'AUD:aware/99999999' },
				{ name: 'VAN', price: 'AUD:vanguard/1' }
			],
			[
				{ portId: '42000100', label: 'High Growth' },
				{ portId: '42000096', label: 'Cash' },
				{ portId: '99999999', label: 'Gone' }
			]
		);
		expect(covered).toEqual(['AWARE_HG', 'AWARE_CASH', 'AWARE_GONE']);

		const fetched = await provider.fetchLatest(covered);
		expect(fetched).toEqual({
			source: 'aware',
			asOf: '2026-11-13',
			quotes: [{ base: 'AWARE_HG', rate: 12.881781, quote: 'AUD', date: '2026-11-13' }],
			missing: ['AWARE_CASH', 'AWARE_GONE']
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const init = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(init[1].headers).toEqual({ [UPSTREAM_KEY_HEADER]: 'key' });
	});

	it('fails without a key and on a rejected key, before any parsing', async () => {
		const noKey = createAwarePriceProvider(ok(), async () => '');
		await expect(noKey.fetchCatalogue!()).rejects.toThrow(/API key/);

		const rejected = createAwarePriceProvider(
			vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
			async () => 'bad'
		);
		await expect(rejected.fetchCatalogue!()).rejects.toThrow(/rejected/);
	});

	it('validateSpec requires the numeric option id', () => {
		const provider = createAwarePriceProvider(ok(), async () => 'k');
		const spec = (symbol: string) => ({ quote: 'AUD', source: 'aware', symbol, inverted: false });
		expect(provider.validateSpec?.('X', spec('42000100'))).toBeNull();
		expect(provider.validateSpec?.('X', spec('HighGrowth'))).toMatch(/numeric/);
	});
});

describe('proxy upstream key', () => {
	const proxied = (target: string) =>
		new Request(`https://cashier.test/api/proxy?url=${encodeURIComponent(target)}`, {
			headers: { [UPSTREAM_KEY_HEADER]: 'k' }
		});

	it('forwards the key as X-API-KEY to Aware only', async () => {
		const fetchImpl = vi.fn(async () => new Response('{}'));
		const like = fetchImpl as unknown as FetchLike;
		await handleProxyRequest(proxied('https://api.aware.com.au/x'), { fetchImpl: like });
		await handleProxyRequest(proxied('https://www.vanguard.com.au/x'), { fetchImpl: like });
		const sent = (n: number) =>
			(fetchImpl.mock.calls[n] as unknown as [unknown, RequestInit])[1].headers as Record<string, string>;
		expect(sent(0)['X-API-KEY']).toBe('k');
		expect(sent(1)['X-API-KEY']).toBeUndefined();
	});
});
