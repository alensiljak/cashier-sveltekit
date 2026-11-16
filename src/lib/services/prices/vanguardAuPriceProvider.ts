/**
 * Vanguard Australia fund and ETF NAVs.
 *
 * The public site API is origin-locked (`Access-Control-Allow-Origin:
 * https://www.vanguard.com.au`), so every request goes through the app's
 * same-origin CORS proxy (`worker/proxy.ts`). Two endpoints are used:
 *
 *   GET /personal/api/products/personal/funds/allfunds
 *     → { data: [{ portId, tradingSymbols: { APIR, TICKER }, … }] }
 *   GET /personal/api/products/personal/fund/{portId}/prices?limit=1
 *     → { data: [{ navPrices: [{ asOfDate, currencyCode, price }] }] }
 *
 * The catalogue maps the book's commodity metadata (`apir` for managed funds,
 * `ticker` for ETFs) to a `portId`; the commodity name is never guessed. The
 * old Python downloader called `…/detail?limit=1` and hardcoded two fund ids;
 * `…/prices?limit=1` returns the same NAV fields in ~650 bytes instead of
 * ~1.1 MB.
 *
 * This is an undocumented API. The provider is deliberately a thin parser:
 * every failure aborts the run before the destination file is written.
 */

import type { DeclaredCommodity, FetchedQuotes, PriceProvider, PriceQuote } from './priceProvider';
import { proxyFetch } from './proxyFetch';

const CATALOGUE_URL = 'https://www.vanguard.com.au/personal/api/products/personal/funds/allfunds';

function pricesUrl(portId: string): string {
	return `https://www.vanguard.com.au/personal/api/products/personal/fund/${portId}/prices?limit=1`;
}

/** Port ids are numeric (`8105`) or short alphanumeric (`F105`, `0991`). */
const PORT_ID = /^[A-Za-z0-9]+$/;
/** Calendar-valid ISO date (rejects e.g. `2026-11-32`, `13-45`). */
const ISO_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export interface VanguardPrice {
	date: string;
	rate: number;
	quote: string;
}

/**
 * Runtime-checked object view of parsed JSON. Property reads stay `unknown`
 * and are validated by the caller; the cast only asserts that the value is a
 * non-null, non-array object, which the guard above already proved.
 */
function recordOf(value: unknown, what: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`Vanguard ${what} is not an object`);
	}
	const record: Record<string, unknown> = value as Record<string, unknown>;
	return record;
}

function bodyData(body: unknown, what: string): unknown[] {
	const record = recordOf(body, `${what} response`);
	if (typeof record.statusCode === 'number' && record.statusCode !== 200) {
		throw new Error(`Vanguard ${what} response has status ${record.statusCode}`);
	}
	if (!Array.isArray(record.data)) {
		throw new Error(`Vanguard ${what} response has no data array`);
	}
	return record.data;
}

/**
 * Parse the product catalogue into an identifier → portId map. Both APIR
 * (managed funds) and ASX ticker (ETFs) are indexed; products carrying
 * neither cannot be matched to a book commodity and are skipped.
 */
export function parseVanguardCatalogue(body: unknown): Map<string, string> {
	const data = bodyData(body, 'product list');
	const identifiers = new Map<string, string>();
	for (const [i, entry] of data.entries()) {
		const product = recordOf(entry, `product list entry ${i}`);
		const portId = product.portId;
		if (typeof portId !== 'string' || !PORT_ID.test(portId)) {
			throw new Error(`Vanguard product list entry ${i} has no valid portId`);
		}
		const symbols = product.tradingSymbols;
		if (typeof symbols !== 'object' || symbols === null) continue;
		const tradingSymbols = recordOf(symbols, `product list entry ${i} tradingSymbols`);
		for (const id of [tradingSymbols.APIR, tradingSymbols.TICKER]) {
			if (typeof id === 'string' && id !== '') identifiers.set(id, portId);
		}
	}
	if (identifiers.size === 0) {
		throw new Error('Vanguard product list contains no APIR or ticker identifiers');
	}
	return identifiers;
}

/**
 * Parse one fund's price response. Returns null when the fund exists but has
 * no NAV yet (reported as `missing`); malformed data throws.
 */
export function parseVanguardPrice(body: unknown): VanguardPrice | null {
	const data = bodyData(body, 'price');
	if (data.length === 0) return null;
	const fund = recordOf(data[0], 'price response entry');
	const navPrices = fund.navPrices;
	if (navPrices === undefined || navPrices === null) return null;
	if (!Array.isArray(navPrices)) {
		throw new Error('Vanguard price response has no navPrices array');
	}

	let latest: VanguardPrice | null = null;
	for (const [i, entry] of navPrices.entries()) {
		const navPrice = recordOf(entry, `navPrices entry ${i}`);
		const { asOfDate, currencyCode, price } = navPrice;
		if (typeof asOfDate !== 'string' || !ISO_DATE.test(asOfDate)) {
			throw new Error(`Vanguard navPrices entry ${i} has no valid date`);
		}
		if (typeof currencyCode !== 'string' || currencyCode === '') {
			throw new Error(`Vanguard navPrices entry ${i} has no currency`);
		}
		if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
			throw new Error(`Vanguard navPrices entry ${i} has no valid price`);
		}
		// `limit=1` returns one entry, but pick the newest defensively.
		if (!latest || asOfDate > latest.date) {
			latest = { date: asOfDate, rate: price, quote: currencyCode };
		}
	}
	return latest;
}

/** The slice of `Response` this provider needs; `proxyFetch` satisfies it. */
export interface VanguardResponse {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}

export type VanguardFetch = (url: string) => Promise<VanguardResponse>;

/** Securities providers always implement the optional catalogue hook. */
export interface VanguardAuPriceProvider extends PriceProvider {
	resolveCovered(commodities: DeclaredCommodity[]): Promise<string[]>;
}

/**
 * Create a provider with an injectable fetch (unit tests). The registered
 * singleton below uses `proxyFetch`, which adds the shared proxy key.
 */
export function createVanguardAuPriceProvider(
	fetchImpl: VanguardFetch = proxyFetch
): VanguardAuPriceProvider {
	let cataloguePromise: Promise<Map<string, string>> | null = null;
	let resolved = new Map<string, string>();

	async function catalogue(): Promise<Map<string, string>> {
		cataloguePromise ??= (async () => {
			const response = await fetchImpl(CATALOGUE_URL);
			if (!response.ok) {
				throw new Error(`Vanguard product list request failed: HTTP ${response.status}`);
			}
			return parseVanguardCatalogue(await response.json());
		})().catch((err: unknown) => {
			// A failed catalogue fetch must not poison later attempts (e.g. after
			// the user fixes the proxy key).
			cataloguePromise = null;
			throw err;
		});
		return cataloguePromise;
	}

	function portIdFor(
		commodity: DeclaredCommodity,
		identifiers: Map<string, string>
	): string | undefined {
		for (const id of [commodity.apir, commodity.ticker]) {
			if (!id) continue;
			const portId = identifiers.get(id);
			if (portId) return portId;
		}
		return undefined;
	}

	return {
		id: 'vanguard-au',
		name: 'Vanguard Australia (fund NAVs)',
		kind: 'securities',
		base: 'AUD',
		covers(symbol) {
			return resolved.has(symbol);
		},
		async resolveCovered(commodities) {
			if (commodities.length === 0) {
				resolved = new Map();
				return [];
			}
			const identifiers = await catalogue();
			resolved = new Map();
			const covered: string[] = [];
			for (const commodity of commodities) {
				const portId = portIdFor(commodity, identifiers);
				if (!portId) continue;
				resolved.set(commodity.name, portId);
				covered.push(commodity.name);
			}
			return covered;
		},
		async fetchLatest(symbols) {
			await catalogue();
			const products = symbols.map((symbol) => {
				const portId = resolved.get(symbol);
				if (!portId) throw new Error(`No Vanguard Australia product for ${symbol}`);
				return { symbol, portId };
			});

			const fetched = await Promise.all(
				products.map(async ({ symbol, portId }) => {
					const response = await fetchImpl(pricesUrl(portId));
					if (!response.ok) {
						throw new Error(`Vanguard price request for ${symbol} failed: HTTP ${response.status}`);
					}
					return { symbol, price: parseVanguardPrice(await response.json()) };
				})
			);

			const quotes: PriceQuote[] = [];
			const missing: string[] = [];
			for (const { symbol, price } of fetched) {
				if (!price) {
					missing.push(symbol);
					continue;
				}
				quotes.push({ base: symbol, rate: price.rate, quote: price.quote, date: price.date });
			}
			if (quotes.length === 0) {
				throw new Error('Vanguard returned no prices for the requested products');
			}
			const asOf = quotes.reduce((max, q) => ((q.date ?? '') > max ? (q.date ?? '') : max), '');
			return { source: 'vanguard-au', asOf, quotes, missing } satisfies FetchedQuotes;
		}
	};
}

export const vanguardAuPriceProvider = createVanguardAuPriceProvider();
