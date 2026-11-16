/**
 * Derives the book-relevant set of symbols to fetch (Price Download design,
 * doc/projects/2026-11-15_price-download.md).
 *
 * Candidates come from what the book actually uses: the app's default
 * currency, the ledger's operating currencies, both sides of existing price
 * directives, and the currencies of open accounts. They are then classified:
 *
 * - Securities (commodity directives with ticker/ISIN metadata, out of the
 *   provider's range anyway) are irrelevant for FX and never listed as
 *   skips — they move to their own `securities` bucket.
 * - Currencies the provider cannot serve are skipped with a reason.
 * - For currency candidates whose EUR-pair the book already maintains, the
 *   download must NOT write a second, opposite-direction series: the ledger
 *   coalesces both directions of a pair (the denser series wins), so a fresh
 *   opposite-direction series would be silently ignored. Instead the new
 *   rates are written in the book's own series direction, extending it with
 *   new fixing dates.
 */

import fullLedgerService from '#lib/services/ledgerWorkerClient';

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
	/** Securities (ticker/ISIN commodities) among the candidates — not FX. */
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
 * Pure core: classify candidates. Direction comes from the book's own series
 * (`userPairs`, one entry per directive, destination file excluded) first; only
 * when the user keeps none for a pair do the destination file's earlier
 * downloads (`destinationPairs`) decide. Within a tier the denser direction wins.
 */
export function derivePriceSymbols(input: {
	/** Provider's native base (candidates equal to it are meaningless). */
	base: string;
	defaultCurrency: string | null;
	operatingCurrencies: string[];
	pairCurrencies: string[];
	accountCurrencies: string[];
	/** The user's own price directives, one entry per directive (destination excluded). */
	userPairs: PricePair[];
	/** Price directives previously written to the destination file, one per directive. */
	destinationPairs: PricePair[];
	/** Declared securities (commodity directives with ticker/ISIN metadata). */
	declaredSecurities: string[];
	covers: (symbol: string) => boolean;
}): SymbolPlan {
	const securities = new Set(input.declaredSecurities);
	const symbols: string[] = [];
	const invertedSymbols: string[] = [];
	const skippedUnsupported: string[] = [];
	const securitiesOut: string[] = [];
	const seen = new Set<string>();

	const candidates = [
		input.defaultCurrency,
		...input.operatingCurrencies,
		...input.pairCurrencies,
		...input.accountCurrencies
	];
	for (const candidate of candidates) {
		if (!candidate || candidate === input.base || seen.has(candidate)) continue;
		seen.add(candidate);

		if (securities.has(candidate)) {
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

/** Currencies of open accounts (posting/commodity currencies included). */
export async function fetchAccountCurrencies(): Promise<string[]> {
	const accounts = await fullLedgerService.getAllAccounts();
	const currencies = new Set<string>();
	for (const account of accounts) {
		for (const currency of account.currencies ?? []) currencies.add(currency);
	}
	return [...currencies];
}

/**
 * Securities declared in the book: `commodity` directives carrying ticker or
 * ISIN metadata. Plain currencies (covered by providers anyway) may also be
 * declared without that metadata and are not securities.
 */
export async function fetchDeclaredSecurities(): Promise<string[]> {
	const directives = (await fullLedgerService.getDirectives()) as Array<{
		type?: string;
		currency?: unknown;
		meta?: Record<string, unknown>;
	}>;
	const securities: string[] = [];
	for (const directive of directives) {
		if (directive.type !== 'commodity' || typeof directive.currency !== 'string') continue;
		if (directive.meta?.isin || directive.meta?.ticker) securities.push(directive.currency);
	}
	return securities;
}
