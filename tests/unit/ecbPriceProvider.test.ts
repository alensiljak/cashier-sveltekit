/*
    Tests for the ECB price provider: coverage set, Frankfurter response
    validation (the pinned /providers/ecb/rates endpoint), and fetchLatest
    against a stubbed fetch. fetch is stubbed so no network is touched.
*/
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ECB_SYMBOLS,
	ecbPriceProvider,
	parseEcbResponse
} from '#lib/services/prices/ecbPriceProvider';

const fixing = [
	{ date: '2026-11-13', base: 'EUR', quote: 'CHF', rate: 0.9266 },
	{ date: '2026-11-13', base: 'EUR', quote: 'USD', rate: 1.1052 }
];

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('ecbPriceProvider.covers', () => {
	it('covers the ECB reference-rate currencies', () => {
		expect(ecbPriceProvider.covers('USD')).toBe(true);
		expect(ecbPriceProvider.covers('CHF')).toBe(true);
		expect(ECB_SYMBOLS).not.toContain('EUR');
	});

	it('does not cover commodities or the base itself', () => {
		expect(ecbPriceProvider.covers('VTI')).toBe(false);
		expect(ecbPriceProvider.covers('RING')).toBe(false);
		expect(ecbPriceProvider.covers('EUR')).toBe(false);
	});
});

describe('parseEcbResponse missing symbols', () => {
	it('reports requested symbols absent from the response', () => {
		const one = [{ date: '2026-11-13', base: 'EUR', quote: 'USD', rate: 1.1052 }];
		const parsed = parseEcbResponse(one, ['USD', 'CHF']);
		expect(parsed.quotes).toHaveLength(1);
		expect(parsed.missing).toEqual(['CHF']);
	});
});

describe('parseEcbResponse', () => {
	it('maps a valid response to EUR-base quotes with the response date', () => {
		const parsed = parseEcbResponse(fixing, ['USD', 'CHF']);
		expect(parsed.asOf).toBe('2026-11-13');
		expect(parsed.source).toBe('ecb');
		expect([...parsed.quotes].sort((a, b) => a.quote.localeCompare(b.quote))).toEqual([
			{ base: 'EUR', rate: 0.9266, quote: 'CHF' },
			{ base: 'EUR', rate: 1.1052, quote: 'USD' }
		]);
	});

	it('rejects a non-array or empty body', () => {
		expect(() => parseEcbResponse({}, ['USD'])).toThrow();
		expect(() => parseEcbResponse([], ['USD'])).toThrow();
	});

	it('rejects entries that are not EUR-based', () => {
		expect(() => parseEcbResponse([{ ...fixing[1], base: 'USD' }], ['USD'])).toThrow(/EUR-based/);
	});

	it('rejects quotes that were not requested', () => {
		expect(() => parseEcbResponse(fixing, ['USD'])).toThrow(/unrequested/);
	});

	it('rejects invalid rates', () => {
		expect(() => parseEcbResponse([{ ...fixing[1], rate: 0 }], ['USD'])).toThrow();
		expect(() => parseEcbResponse([{ ...fixing[1], rate: -1 }], ['USD'])).toThrow();
		expect(() => parseEcbResponse([{ ...fixing[1], rate: '1.1' }], ['USD'])).toThrow();
	});

	it('rejects missing or malformed dates', () => {
		expect(() => parseEcbResponse([{ ...fixing[1], date: '2026-11-32' }], ['USD'])).toThrow();
		expect(() => parseEcbResponse([{ ...fixing[1], date: 'today' }], ['USD'])).toThrow();
	});

	it('rejects a response that mixes fixing dates', () => {
		const mixed = [fixing[0], { ...fixing[1], date: '2026-11-12' }];
		expect(() => parseEcbResponse(mixed, ['USD', 'CHF'])).toThrow(/different dates/);
	});
});

describe('ecbPriceProvider.fetchLatest', () => {
	function stubFetch(body: unknown, status = 200) {
		return vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
	}

	it('requests only covered symbols and parses the response', async () => {
		const fetchMock = stubFetch(fixing);
		vi.stubGlobal('fetch', fetchMock);

		const fetched = await ecbPriceProvider.fetchLatest(['USD', 'VTI', 'CHF']);
		expect(fetched.asOf).toBe('2026-11-13');
		expect(fetched.quotes).toHaveLength(2);

		const url = String(fetchMock.mock.calls[0]?.[0]);
		expect(url).toContain('/v2/providers/ecb/rates');
		expect(url).toContain('base=EUR');
		expect(url).toContain('quotes=USD,CHF');
		expect(url).not.toContain('VTI');
	});

	it('throws when no requested symbol is covered', async () => {
		vi.stubGlobal('fetch', stubFetch(fixing));
		await expect(ecbPriceProvider.fetchLatest(['VTI', 'BND'])).rejects.toThrow(
			/No requested symbol/
		);
	});

	it('throws on an HTTP error status and leaves nothing written', async () => {
		vi.stubGlobal('fetch', stubFetch({}, 500));
		await expect(ecbPriceProvider.fetchLatest(['USD'])).rejects.toThrow(/HTTP 500/);
	});

	it('propagates validation errors', async () => {
		vi.stubGlobal('fetch', stubFetch([{ date: '2026-11-13', base: 'XXX', quote: 'USD', rate: 1 }]));
		await expect(ecbPriceProvider.fetchLatest(['USD'])).rejects.toThrow(/EUR-based/);
	});
});
