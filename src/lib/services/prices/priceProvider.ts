/**
 * Price provider abstraction for the Price Download feature
 * (doc/completed-projects/2026-11-15_price-download.md).
 *
 * Providers fetch prices in their **native published direction** (ECB quotes
 * are EUR-base, a fund NAV is quoted in its fund currency) and the downloaded
 * file stores them verbatim — the ledger engine inverts and chains pairs on
 * lookup, so no re-denomination happens anywhere in this module (pinned by
 * tests/unit/priceConversion.test.ts).
 *
 * Two kinds share the interface:
 * - `fx` providers serve currencies (ECB reference rates).
 * - `securities` providers serve commodities declared in the book (fund NAVs,
 *   ETF prices). Their plan comes from `commodity` directives, not from the
 *   book's currencies, and their quotes are always `commodity → quote`.
 */

export type PriceProviderKind = 'fx' | 'securities';

/** A declared `commodity` directive: the book's explicit vocabulary. */
export interface DeclaredCommodity {
	/** Commodity name — the `base` of the written price directive. */
	name: string;
	ticker?: string;
	isin?: string;
	apir?: string;
}

export interface PriceQuote {
	/** Currency/commodity being priced (the directive's base). */
	base: string;
	/** Price of one unit of `base`. */
	rate: number;
	/** Currency the price is quoted in. */
	quote: string;
	/**
	 * Publication date for this quote, ISO. Defaults to `FetchedQuotes.asOf`
	 * when the whole batch shares one date (FX fixings). Securities providers
	 * set it per quote: funds are not all priced on the same day.
	 */
	date?: string;
}

export interface FetchedQuotes {
	/** Provider id, echoed back for status display. */
	source: string;
	/**
	 * Latest publication date for the batch, ISO. Must come from the response,
	 * never the clock: before ~16:00 CET and on weekends the latest fixing is a
	 * previous business day.
	 */
	asOf: string;
	/** Pairs in the provider's published direction, verbatim. */
	quotes: PriceQuote[];
	/** Requested symbols the response did not contain (not written). */
	missing: string[];
}

export interface PriceProvider {
	id: string;
	/** Shown in the provider dropdown. */
	name: string;
	kind: PriceProviderKind;
	/** The base of the provider's native pairs ('EUR' for ECB, 'AUD' for a fund NAV). */
	base: string;
	/** Whether the provider can serve prices for `symbol`. */
	covers(symbol: string): boolean;
	/**
	 * Securities providers that match by metadata override this: given every
	 * declared commodity, return the names they can serve. Providers that match
	 * by symbol alone can omit it and rely on `covers`. The result is cached for
	 * `fetchLatest`.
	 */
	resolveCovered?(commodities: DeclaredCommodity[]): Promise<string[]>;
	/** Fetch the latest prices for `symbols` (all must be covered). */
	fetchLatest(symbols: string[]): Promise<FetchedQuotes>;
}
