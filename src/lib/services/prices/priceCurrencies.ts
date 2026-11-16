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
 * Pure core: classify candidates. `ownedPairs` is the list of pairs the book
 * already maintains for base ↔ candidate, **priority-ordered**: the book's own
 * (non-destination) series first, the destination file's own pairs after, so a
 * series the user maintains wins over pairs this app downloaded earlier.
 */
export function derivePriceSymbols(input: {
	/** Provider's native base (candidates equal to it are meaningless). */
	base: string;
	defaultCurrency: string | null;
	operatingCurrencies: string[];
	pairCurrencies: string[];
	accountCurrencies: string[];
	/** Pairs of the recommended direction series, priority-ordered. */
	ownedPairs: PricePair[];
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
		const series = input.ownedPairs.find(
			(p) =>
				(p.base === input.base && p.quote === candidate) ||
				(p.base === candidate && p.quote === input.base)
		);
		if (series && series.quote === input.base) {
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
