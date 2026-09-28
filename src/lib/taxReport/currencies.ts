/** A (units currency, cost currency) pair as found on the book's postings. */
export interface CurrencyUsage {
	currency: string;
	costCurrency?: string | null;
}

/**
 * The book's real currencies, i.e. commodities that are not securities.
 *
 * Beancount has no "security" flag, so a commodity counts as a security when it is
 * held at cost (has a cost currency on any posting). Cost currencies themselves are
 * currencies. Operating currencies declared in the book are always included.
 */
export function detectCurrencies(
	usages: CurrencyUsage[],
	operatingCurrencies: string[] = []
): string[] {
	const used = new Set<string>();
	const heldAtCost = new Set<string>();
	const costCurrencies = new Set<string>();

	for (const u of usages) {
		if (!u.currency) continue;
		used.add(u.currency);
		if (u.costCurrency) {
			heldAtCost.add(u.currency);
			costCurrencies.add(u.costCurrency);
		}
	}

	const result = new Set<string>(operatingCurrencies);
	for (const c of used) if (!heldAtCost.has(c)) result.add(c);
	for (const c of costCurrencies) result.add(c);
	return [...result].sort();
}

/** A posting with its original units and the amount after CONVERT to the report currency. */
export interface ConvertedAmount {
	currency: string;
	units: number;
	converted: number;
}

/**
 * Currencies that were not converted to the report currency. When the book has no
 * price path to the target, BQL CONVERT returns the amount unchanged, so a
 * different currency whose converted amount equals its units has no exchange rate.
 */
export function findUnconvertedCurrencies(rows: ConvertedAmount[], target: string): string[] {
	const missing = new Set<string>();
	for (const r of rows) {
		if (!r.currency || r.currency === target || r.units === 0) continue;
		if (r.converted === r.units) missing.add(r.currency);
	}
	return [...missing].sort();
}
