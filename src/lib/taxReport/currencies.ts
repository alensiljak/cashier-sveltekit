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
