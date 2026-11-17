/**
 * ECB daily reference rates straight from the ECB's own XML feed.
 *
 * The feed sends no CORS headers, so it is fetched through the app's
 * same-origin proxy (`proxyFetch`); `www.ecb.europa.eu` must be in the
 * Worker's `ALLOWED_HOSTS`. Serves the same fixings as the Frankfurter-backed
 * provider, without the third-party dependency, but needs the proxy.
 *
 * Feed shape (latest fixing only):
 *   <Cube><Cube time='2026-11-13'>
 *     <Cube currency='USD' rate='1.0812'/> ...
 */

import { ECB_SYMBOLS, validateEcbSpec } from './ecbPriceProvider';
import type { FetchedQuotes, PriceProvider } from './priceProvider';
import { proxyFetch } from './proxyFetch';

export const ECB_FEED_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

const COVERED = new Set(ECB_SYMBOLS);
const ISO_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const TIMEOUT_MS = 15_000;

/** Parse the ECB daily XML for the requested symbols. Exported for unit tests. */
export function parseEcbXml(xml: string, requested: string[]): FetchedQuotes {
	const dateMatch = /<Cube\s+time=["']([^"']+)["']/.exec(xml);
	const asOf = dateMatch?.[1] ?? '';
	if (!ISO_DATE.test(asOf)) {
		throw new Error('ECB feed has no valid fixing date');
	}

	const rates = new Map<string, number>();
	for (const m of xml.matchAll(
		/<Cube\s+currency=["']([A-Z]{3})["']\s+rate=["']([^"']+)["']\s*\/?>/g
	)) {
		const rate = Number(m[2]);
		if (!Number.isFinite(rate) || rate <= 0) {
			throw new Error(`ECB feed has an invalid rate for ${m[1]}`);
		}
		rates.set(m[1], rate);
	}
	if (rates.size === 0) {
		throw new Error('ECB feed contains no rates');
	}

	const quotes = requested
		.filter((s) => rates.has(s))
		.map((quote) => ({ base: 'EUR', rate: rates.get(quote)!, quote }));
	const missing = requested.filter((s) => !rates.has(s));
	return { source: 'ecb', asOf, quotes, missing };
}

export const ecbDirectPriceProvider: PriceProvider = {
	id: 'ecb-direct',
	name: 'ECB reference rates (direct, via proxy)',
	kind: 'fx',
	base: 'EUR',
	covers(symbol) {
		return COVERED.has(symbol);
	},
	validateSpec: validateEcbSpec,
	async fetchLatest(symbols) {
		const covered = symbols.filter((s) => COVERED.has(s));
		if (covered.length === 0) {
			throw new Error('No requested symbol is served by the ECB');
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
		try {
			const response = await proxyFetch(ECB_FEED_URL, { signal: controller.signal });
			if (!response.ok) {
				throw new Error(`ECB feed request failed: HTTP ${response.status}`);
			}
			return parseEcbXml(await response.text(), covered);
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				throw new Error(`ECB feed request timed out after ${TIMEOUT_MS / 1000}s`);
			}
			throw err;
		} finally {
			clearTimeout(timeout);
		}
	}
};
