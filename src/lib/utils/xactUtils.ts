import { Posting, type Xact } from '$lib/data/model';
import { DirectiveFormatter } from '$lib/rledger/directiveFormatter';

export const PLACEHOLDER_ACCOUNT = 'Expenses:Uncategorized';

/**
 * Convert an Xact to a Beancount transaction string using DirectiveFormatter.
 *
 * @param defaultCurrency Fallback currency for postings that need an explicit
 * zero amount (see below) but have none of their own set.
 */
export function xactToBeancountText(tx: Xact, defaultCurrency?: string): string {
	// Keep all postings; never drop rows the user added.
	// Force ! flag whenever any posting lacks an explicit account.
	const hasPlaceholder = tx.postings.some((p) => !p.account);
	const flag = hasPlaceholder ? '!' : (tx.flag ?? '*');

	// Beancount only allows a single posting per transaction to have its amount
	// elided (auto-balanced) — a second one is ambiguous. And even the one
	// allowed elided posting is a trap when it interpolates to exactly zero
	// (e.g. a "note entry" with no amounts anywhere, or one where the explicit
	// amounts already sum to zero): the ledger engine silently drops a
	// zero-amount interpolated posting on the next parse/round-trip, which is
	// how a saved posting can vanish. Only leave one posting elided when doing
	// so is both unambiguous (it's the sole amount-less posting) AND safe (the
	// explicit amounts don't already sum to zero); force everything else to an
	// explicit zero amount instead, so every posting the user added survives.
	const withoutAmount = tx.postings.filter((p) => p.amount == null);
	const sumOfExplicitAmounts = tx.postings.reduce(
		(sum, p) => (p.amount != null ? sum + p.amount : sum),
		0
	);
	const forceZeroFor = new Set(
		withoutAmount.length === 0
			? []
			: sumOfExplicitAmounts === 0
				? withoutAmount
				: withoutAmount.slice(0, -1)
	);
	const fallbackCurrency =
		defaultCurrency || tx.postings.find((p) => p.currency)?.currency || '';

	const directive = {
		type: 'transaction' as const,
		date: tx.date ?? '',
		flag,
		payee: tx.payee ?? '',
		narration: tx.note ?? '',
		tags: [],
		links: [],
		meta: tx.meta ?? {},
		postings: tx.postings.map((p) => {
			let units: { number: string; currency: string } | undefined;
			if (p.amount != null) {
				units = { number: String(p.amount), currency: p.currency };
			} else if (forceZeroFor.has(p)) {
				// A second (or later) posting with no amount — make it explicit so it
				// isn't ambiguous with the one posting Beancount allows to auto-balance.
				units = { number: '0', currency: p.currency || fallbackCurrency };
			} else if (!p.account && p.currency) {
				// No account but currency set — default to 0 to preserve the placeholder posting.
				units = { number: '0', currency: p.currency };
			}
			// Account set with no amount (the sole elided posting), or neither → omit units
			// (Beancount auto-balance posting).

			let cost: Record<string, unknown> | undefined;
			if (p.costAmount != null && p.costCurrency) {
				cost = { number: String(p.costAmount), currency: p.costCurrency };
				if (p.costDate) cost.date = p.costDate;
			}

			let price: Record<string, unknown> | undefined;
			if (p.priceAmount != null && p.priceCurrency) {
				price = {
					number: String(p.priceAmount),
					currency: p.priceCurrency,
					total: p.totalPrice ?? false
				};
			}

			return {
				account: p.account || PLACEHOLDER_ACCOUNT,
				units,
				cost,
				price
			};
		})
	};
	return DirectiveFormatter.toString(directive as any);
}

/**
 * Find an empty posting, or create one.
 */
export function getEmptyPostingIndex(tx: Xact) {
	if (!tx) {
		throw new Error('No transaction loaded!');
	}

	for (let i = 0; i < tx.postings.length; i++) {
		const posting = tx.postings[i];
		if (!posting.account && !posting.amount && !posting.currency) {
			return i;
		}
	}

	// not found. Create a new one.
	const posting = new Posting();
	tx.postings.push(posting);
	return tx.postings.length - 1;
}
