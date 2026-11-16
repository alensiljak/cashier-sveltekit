/**
 * Price provider abstraction for the Price Download feature
 * (doc/projects/2026-11-15_price-download.md).
 *
 * Providers fetch prices in their **native published direction** (ECB quotes
 * are EUR-base) and the downloaded file stores them verbatim — the ledger
 * engine inverts and chains pairs on lookup, so no re-denomination happens
 * anywhere in this module (pinned by tests/unit/priceConversion.test.ts).
 */

export interface PriceQuote {
	/** Currency/commodity being priced (the directive's base). */
	base: string;
	/** Price of one unit of `base`. */
	rate: number;
	/** Currency the price is quoted in. */
	quote: string;
}

export interface FetchedQuotes {
	/** Provider id, echoed back for status display. */
	source: string;
	/**
	 * Fixing date in ISO. Must come from the response, never the clock:
	 * before ~16:00 CET and on weekends the latest fixing is a previous
	 * business day.
	 */
	asOf: string;
	/** Pairs in the provider's published direction, verbatim. */
	quotes: PriceQuote[];
}

export interface PriceProvider {
	id: string;
	/** Shown in the provider dropdown. */
	name: string;
	/** The base of the provider's native pairs ('EUR' for ECB). */
	base: string;
	/** Whether the provider can serve prices for `symbol`. */
	covers(symbol: string): boolean;
	/** Fetch the latest fixing for `symbols` (all must be covered). */
	fetchLatest(symbols: string[]): Promise<FetchedQuotes>;
}
