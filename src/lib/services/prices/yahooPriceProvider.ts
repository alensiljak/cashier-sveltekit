/**
 * Yahoo Finance latest prices (port of alens-pricedl's `YahooFinanceDownloader`).
 *
 *   GET https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
 *     → { chart: { error: null,
 *                  result: [{ meta: { currency: "AUD", regularMarketPrice: 31.2,
 *                                     regularMarketTime: 1763000000, gmtoffset: 39600 } }] } }
 *
 * Yahoo sends no CORS headers for the app's origin and rejects non-browser
 * user agents, so requests go through the CORS proxy (which sends a browser UA
 * to this host).
 *
 * A book commodity links through its `price` meta: `AUD:yahoo/ASX:VHY`. The
 * symbol is `NAMESPACE:MNEMONIC` (translated to Yahoo's exchange suffix) or a
 * bare Yahoo symbol (`AAPL`, `VHY.AX`, `^GSPC`, `AUDUSD=X`). The quote currency
 * and date come from the response, not from the `price` meta.
 *
 * Undocumented API: the provider is a thin, strict parser — any failure aborts
 * the run before the destination file is written.
 */

import { parsePriceMeta } from './bookPricePlan';
import type {
	DeclaredCommodity,
	FetchedQuotes,
	PriceProvider,
	PriceQuote,
	PriceSpec
} from './priceProvider';
import { proxyFetch } from './proxyFetch';

/** The `source` in a commodity's `price` meta that selects this provider. */
export const YAHOO_NICKNAME = 'yahoo';

/**
 * `yahoo`, or a Python module path ending in it (`alens.pricedl.beanprice.yahoo`,
 * `beanprice.yahoo`), as books written for bean-price carry.
 */
export function isYahooSource(source: string): boolean {
	return source === YAHOO_NICKNAME || source.endsWith(`.${YAHOO_NICKNAME}`);
}

const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';

/** Exchange namespace → Yahoo suffix (empty = no suffix). Same table as the Python downloader. */
const NAMESPACE_SUFFIX: Record<string, string> = {
	AMS: 'AS',
	ASX: 'AX',
	BATS: '',
	BVME: 'MI',
	FWB: 'F',
	LSE: 'L',
	NASDAQ: '',
	NYSE: '',
	NYSEARCA: '',
	XETRA: 'DE'
};

/**
 * Sub-unit quote currencies Yahoo uses → [Beancount currency, divisor].
 * London-listed securities are quoted in pence (`GBp`), which is not a valid
 * Beancount currency and is 1/100 of GBP.
 */
const SUBUNITS: Record<string, [string, number]> = {
	GBp: ['GBP', 100],
	GBX: ['GBP', 100],
	ZAc: ['ZAR', 100]
};

/** Beancount currency: uppercase letters/digits and `'._-`, 2–24 chars. */
const CURRENCY = /^[A-Z][A-Z0-9'._-]{0,22}[A-Z0-9]$/;

/** Translate a `price` meta symbol into Yahoo's. `ASX:VHY` → `VHY.AX`; `AAPL` stays. */
export function toYahooSymbol(symbol: string): string {
	const i = symbol.indexOf(':');
	if (i < 0) return symbol;
	const namespace = symbol.slice(0, i);
	const mnemonic = symbol.slice(i + 1);
	const suffix = Object.hasOwn(NAMESPACE_SUFFIX, namespace) ? NAMESPACE_SUFFIX[namespace] : namespace;
	return suffix ? `${mnemonic}.${suffix}` : mnemonic;
}

export function yahooChartUrl(yahooSymbol: string): string {
	return `${CHART_URL}${encodeURIComponent(yahooSymbol)}`;
}

export interface YahooPrice {
	/** Exchange-local date of the quote, ISO. */
	date: string;
	rate: number;
	quote: string;
}

function recordOf(value: unknown, what: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`Yahoo ${what} is not an object`);
	}
	return value as Record<string, unknown>;
}

/** Parse one chart response. Throws on an error payload or a changed shape. */
export function parseYahooPrice(body: unknown): YahooPrice {
	const chart = recordOf(recordOf(body, 'response').chart, 'chart');
	if (chart.error !== null && chart.error !== undefined) {
		const error = chart.error as { description?: unknown; code?: unknown };
		const detail =
			typeof error === 'object' && error && typeof error.description === 'string'
				? error.description
				: JSON.stringify(chart.error);
		throw new Error(`Yahoo error: ${detail}`);
	}
	if (!Array.isArray(chart.result) || chart.result.length === 0) {
		throw new Error('Yahoo response has no result');
	}
	const meta = recordOf(recordOf(chart.result[0], 'result entry').meta, 'meta');

	const { regularMarketPrice: price, regularMarketTime: time, currency, gmtoffset } = meta;
	if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
		throw new Error('Yahoo response has no valid regularMarketPrice');
	}
	if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) {
		throw new Error('Yahoo response has no valid regularMarketTime');
	}
	if (typeof currency !== 'string' || currency === '') {
		throw new Error('Yahoo response has no currency');
	}
	const offset = typeof gmtoffset === 'number' && Number.isFinite(gmtoffset) ? gmtoffset : 0;

	// The exchange-local calendar date, as the Python downloader computed it.
	const date = new Date((time + offset) * 1000).toISOString().slice(0, 10);

	const [quote, divisor] = SUBUNITS[currency] ?? [currency, 1];
	if (!CURRENCY.test(quote)) {
		throw new Error(`Yahoo returned an unusable currency "${currency}"`);
	}
	return { date, rate: price / divisor, quote };
}

/** Yahoo symbol from a commodity's `price` meta when it names the Yahoo source. */
export function yahooSymbolOf(commodity: DeclaredCommodity): string | undefined {
	const spec = parsePriceMeta(commodity.price).specs.find((s) => isYahooSource(s.source));
	return spec && !spec.inverted ? toYahooSymbol(spec.symbol) : undefined;
}

/** The slice of `Response` this provider needs; `proxyFetch` satisfies it. */
export interface YahooResponse {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}
export type YahooFetch = (url: string) => Promise<YahooResponse>;

export function createYahooPriceProvider(fetchImpl: YahooFetch = proxyFetch): PriceProvider {
	/** Commodity name → Yahoo symbol, from the last `resolveCovered`. */
	let resolved = new Map<string, string>();

	return {
		id: 'yahoo',
		name: 'Yahoo Finance (latest prices)',
		kind: 'securities',
		// Quotes carry their own currency; there is no single native base.
		base: 'USD',
		covers(symbol) {
			return resolved.has(symbol);
		},
		// Linking is by `price` meta: the commodities that name this source are served.
		async resolveCovered(commodities) {
			resolved = new Map();
			for (const commodity of commodities) {
				const symbol = yahooSymbolOf(commodity);
				if (symbol) resolved.set(commodity.name, symbol);
			}
			return [...resolved.keys()];
		},
		validateSpec(_commodity: string, spec: PriceSpec) {
			if (spec.inverted) return 'Yahoo prices cannot be inverted (^ prefix)';
			if (/\s/.test(spec.symbol) || spec.symbol.endsWith(':')) {
				return `Invalid Yahoo symbol "${spec.symbol}"`;
			}
			return null;
		},
		async fetchLatest(symbols) {
			const wanted = symbols.map((symbol) => {
				const yahoo = resolved.get(symbol);
				if (!yahoo) throw new Error(`No Yahoo symbol for ${symbol}`);
				return { symbol, yahoo };
			});

			const fetched = await Promise.all(
				wanted.map(async ({ symbol, yahoo }) => {
					const response = await fetchImpl(yahooChartUrl(yahoo));
					if (response.status === 404) return { symbol, price: null };
					if (!response.ok) {
						throw new Error(`Yahoo request for ${symbol} (${yahoo}) failed: HTTP ${response.status}`);
					}
					try {
						return { symbol, price: parseYahooPrice(await response.json()) };
					} catch (err) {
						throw new Error(`${symbol} (${yahoo}): ${err instanceof Error ? err.message : err}`, {
							cause: err
						});
					}
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
				throw new Error('Yahoo returned no prices for the requested symbols');
			}
			const asOf = quotes.reduce((max, q) => ((q.date ?? '') > max ? (q.date ?? '') : max), '');
			return { source: 'yahoo', asOf, quotes, missing } satisfies FetchedQuotes;
		}
	};
}

export const yahooPriceProvider = createYahooPriceProvider();
