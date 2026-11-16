/**
 * ECB daily reference rates via the Frankfurter API.
 *
 * The raw ECB XML feed sends no CORS headers, so a browser PWA cannot fetch
 * it directly; Frankfurter (api.frankfurter.dev — open source, no API key)
 * serves the same rates CORS-enabled. Must be pinned to the ECB provider:
 * Frankfurter v2 aggregates 200+ currencies from 100+ sources including
 * crypto, and we only ever want the ECB fixings.
 *
 * Response shape (verified):
 *   GET /v2/providers/ecb/rates?base=EUR&quotes=USD,CHF
 *   → [{"date":"2026-11-13","base":"EUR","quote":"CHF","rate":0.9266}, ...]
 *
 * Note the `quotes` parameter name (`symbols` returns HTTP 422).
 */

import type { FetchedQuotes, PriceProvider } from './priceProvider';

/**
 * Currencies the ECB publishes daily reference rates for (EUR-base). BGN is
 * absent: Bulgaria joined the euro on 2026-01-01, so there is no BGN rate.
 */
export const ECB_SYMBOLS = [
	'AUD',
	'BRL',
	'CAD',
	'CHF',
	'CNY',
	'CZK',
	'DKK',
	'GBP',
	'HKD',
	'HUF',
	'IDR',
	'ILS',
	'INR',
	'ISK',
	'JPY',
	'KRW',
	'MXN',
	'MYR',
	'NOK',
	'NZD',
	'PHP',
	'PLN',
	'RON',
	'SEK',
	'SGD',
	'THB',
	'TRY',
	'USD',
	'ZAR'
];

const COVERED = new Set(ECB_SYMBOLS);
/** Calendar-valid ISO date (rejects e.g. `2026-11-32`, `13-45`). */
const ISO_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const TIMEOUT_MS = 15_000;

const ENDPOINT = 'https://api.frankfurter.dev/v2/providers/ecb/rates';

interface FrankfurterRate {
	date: string;
	base: string;
	quote: string;
	rate: number;
}

/** Parse and validate a Frankfurter ECB response. Exported for unit tests. */
export function parseEcbResponse(body: unknown, requested: string[]): FetchedQuotes {
	if (!Array.isArray(body) || body.length === 0) {
		throw new Error('ECB response is not a non-empty array');
	}
	const requestedSet = new Set(requested);
	let asOf = '';
	const quotes = body.map((entry, i) => {
		if (typeof entry !== 'object' || entry === null) {
			throw new Error(`ECB response entry ${i} is not an object`);
		}
		const { date, base, quote, rate } = entry as Partial<FrankfurterRate>;
		if (typeof date !== 'string' || !ISO_DATE.test(date)) {
			throw new Error(`ECB response entry ${i} has no valid date`);
		}
		if (base !== 'EUR') {
			throw new Error(`ECB response entry ${i} is not EUR-based`);
		}
		if (typeof quote !== 'string' || !requestedSet.has(quote)) {
			throw new Error(`ECB response entry ${i} quotes an unrequested symbol`);
		}
		if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
			throw new Error(`ECB response entry ${i} has no valid rate`);
		}
		if (asOf === '') asOf = date;
		else if (date !== asOf) {
			throw new Error('ECB response mixes fixings from different dates');
		}
		return { base: 'EUR', rate, quote };
	});
	const returned = new Set(quotes.map((q) => q.quote));
	const missing = requested.filter((s) => !returned.has(s));
	return { source: 'ecb', asOf, quotes, missing };
}

export const ecbPriceProvider: PriceProvider = {
	id: 'ecb-frankfurter',
	name: 'ECB reference rates (via Frankfurter)',
	base: 'EUR',
	covers(symbol) {
		return COVERED.has(symbol);
	},
	async fetchLatest(symbols) {
		const covered = symbols.filter((s) => COVERED.has(s));
		if (covered.length === 0) {
			throw new Error('No requested symbol is served by the ECB');
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
		try {
			const response = await fetch(`${ENDPOINT}?base=EUR&quotes=${covered.join(',')}`, {
				signal: controller.signal
			});
			if (!response.ok) {
				throw new Error(`ECB rates request failed: HTTP ${response.status}`);
			}
			return parseEcbResponse(await response.json(), covered);
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				throw new Error(`ECB rates request timed out after ${TIMEOUT_MS / 1000}s`);
			}
			throw err;
		} finally {
			clearTimeout(timeout);
		}
	}
};
