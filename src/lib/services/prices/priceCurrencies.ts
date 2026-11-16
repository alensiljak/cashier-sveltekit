/**
 * Derives the book-relevant set of symbols to fetch (Price Download design,
 * doc/completed-projects/2026-11-15_price-download.md).
 *
 * Every commodity is declared explicitly in the book, currencies included. The
 * declared `commodity` directives are therefore the single source of
 * candidates; usage (existing price directives) is only consulted for the
 * direction of a pair the book already maintains.
 *
 * - A commodity carrying ticker/ISIN/APIR metadata is a security: the FX plan
 *   moves it to the `securities` bucket, and a securities provider matches it
 *   by that metadata (or by symbol, if it says so through `covers`).
 * - A commodity without an identifier is a currency candidate for an FX
 *   provider; `covers` decides whether the provider publishes it.
 * - For a currency whose pair the book already maintains, the download must
 *   NOT write a second, opposite-direction series: the ledger coalesces both
 *   directions of a pair (the denser series wins), so a fresh
 *   opposite-direction series would be silently ignored. Instead the new rates
 *   are written in the book's own series direction, extending it with new
 *   fixing dates.
 */

import fullLedgerService from '#lib/services/ledgerWorkerClient';
import type { DeclaredCommodity } from './priceProvider';

export interface PricePair {
	base: string;
	quote: string;
}

export interface SymbolPlan {
	/** Symbols to fetch and write in the provider's native direction (base → symbol). */
	symbols: string[];
	/**
	 * Symbols to fetch but write inverted (symbol → base) because the book
	 * maintains its series for the pair in that direction.
	 */
	invertedSymbols: string[];
	/** Currency candidates the provider cannot serve. */
	skippedUnsupported: string[];
	/** Declared commodities carrying an identifier — not FX. */
	securities: string[];
}

/**
 * Direction of the series the given pairs hold for base ↔ candidate: the
 * direction with more directives wins, mirroring how the engine coalesces a
 * pair maintained both ways (denser series wins). A tie keeps the direction
 * seen first. `null` when the pairs hold no series for it.
 */
function seriesDirection(
	pairs: PricePair[],
	base: string,
	candidate: string
): 'native' | 'inverted' | null {
	let native = 0;
	let inverted = 0;
	let first: 'native' | 'inverted' | null = null;
	for (const p of pairs) {
		if (p.base === base && p.quote === candidate) {
			native++;
			first ??= 'native';
		} else if (p.base === candidate && p.quote === base) {
			inverted++;
			first ??= 'inverted';
		}
	}
	if (native === 0 && inverted === 0) return null;
	if (native === inverted) return first;
	return native > inverted ? 'native' : 'inverted';
}

/**
 * Pure core for FX providers. Direction comes from the book's own series
 * (`userPairs`, one entry per directive, destination file excluded) first; only
 * when the user keeps none for a pair do the destination file's earlier
 * downloads (`destinationPairs`) decide. Within a tier the denser direction wins.
 */
export function derivePriceSymbols(input: {
	/** Provider's native base (candidates equal to it are meaningless). */
	base: string;
	/** Every declared commodity, the book's explicit vocabulary. */
	declaredCommodities: DeclaredCommodity[];
	/** The user's own price directives, one entry per directive (destination excluded). */
	userPairs: PricePair[];
	/** Price directives previously written to the destination file, one per directive. */
	destinationPairs: PricePair[];
	covers: (symbol: string) => boolean;
}): SymbolPlan {
	const symbols: string[] = [];
	const invertedSymbols: string[] = [];
	const skippedUnsupported: string[] = [];
	const securitiesOut: string[] = [];
	const seen = new Set<string>();

	for (const commodity of input.declaredCommodities) {
		const candidate = commodity.name;
		if (!candidate || candidate === input.base || seen.has(candidate)) continue;
		seen.add(candidate);

		if (commodity.ticker || commodity.isin || commodity.apir) {
			securitiesOut.push(candidate);
			continue;
		}
		if (!input.covers(candidate)) {
			skippedUnsupported.push(candidate);
			continue;
		}

		// Which direction does the book maintain for base ↔ candidate, if any?
		const direction =
			seriesDirection(input.userPairs, input.base, candidate) ??
			seriesDirection(input.destinationPairs, input.base, candidate);
		if (direction === 'inverted') {
			// The book keeps `candidate → base`: extend it, write inverted.
			invertedSymbols.push(candidate);
		} else {
			// Native direction — either unmaintained, or the book already has
			// it in the same direction, which is exactly what we write.
			symbols.push(candidate);
		}
	}

	return { symbols, invertedSymbols, skippedUnsupported, securities: securitiesOut };
}

/**
 * Pure core for securities providers: every declared commodity is a candidate
 * and the provider's catalogue decides which are covered. No inversion — a
 * fund NAV or ETF price is always written as `commodity → quote currency`.
 */
export function deriveSecuritySymbols(input: {
	declaredCommodities: DeclaredCommodity[];
	/** Commodity names the provider's catalogue covers. */
	covered: string[];
}): SymbolPlan {
	const coveredSet = new Set(input.covered);
	const symbols: string[] = [];
	const skippedUnsupported: string[] = [];
	const seen = new Set<string>();
	for (const commodity of input.declaredCommodities) {
		const name = commodity.name;
		if (!name || seen.has(name)) continue;
		seen.add(name);
		if (coveredSet.has(name)) symbols.push(name);
		// Only an identifier-marked commodity is a security; an uncovered
		// currency is not a "skipped security".
		else if (commodity.ticker || commodity.isin || commodity.apir) skippedUnsupported.push(name);
	}
	return { symbols, invertedSymbols: [], skippedUnsupported, securities: [] };
}

/**
 * The book's `price` directive pairs, from the same BQL `prices` table the
 * worker's currency list is built from: `currency` is the base, `amount`'s
 * currency the quote.
 */
export async function fetchBookPricePairs(): Promise<PricePair[]> {
	const result = await fullLedgerService.query('SELECT currency, amount FROM prices');
	const colBase = result.columns.indexOf('currency');
	const colAmount = result.columns.indexOf('amount');
	const pairs: PricePair[] = [];
	for (const row of result.rows) {
		const base = row[colBase];
		const amount = row[colAmount] as { currency?: string } | null;
		if (typeof base !== 'string' || !amount?.currency) continue;
		pairs.push({ base, quote: amount.currency });
	}
	return pairs;
}

/** Every declared commodity, with the identifiers a provider may match on. */
export async function fetchDeclaredCommodities(): Promise<DeclaredCommodity[]> {
	const directives = await fullLedgerService.getCommodityDirectives();
	return directives.map(({ currency, meta }) => ({
		name: currency,
		ticker: typeof meta?.ticker === 'string' ? meta.ticker : undefined,
		isin: typeof meta?.isin === 'string' ? meta.isin : undefined,
		apir: typeof meta?.apir === 'string' ? meta.apir : undefined
	}));
}
