import { Posting, type Xact } from '$lib/data/model';
import { DirectiveFormatter } from '$lib/rledger/directiveFormatter';

export const PLACEHOLDER_ACCOUNT = 'Expenses:Uncategorized';

/**
 * Convert an Xact to a Beancount transaction string using DirectiveFormatter.
 */
export function xactToBeancountText(tx: Xact): string {
	// Keep all postings; never drop rows the user added.
	// Force ! flag whenever any posting lacks an explicit account.
	const hasPlaceholder = tx.postings.some((p) => !p.account);
	const flag = hasPlaceholder ? '!' : (tx.flag ?? '*');

	const directive = {
		type: 'transaction' as const,
		date: tx.date ?? '',
		flag,
		payee: tx.payee ?? '',
		narration: tx.note ?? '',
		tags: [],
		links: [],
		postings: tx.postings.map((p) => {
			let units: { number: string; currency: string } | undefined;
			if (p.amount != null) {
				units = { number: String(p.amount), currency: p.currency };
			} else if (!p.account && p.currency) {
				// No account but currency set — default to 0 to preserve the placeholder posting.
				units = { number: '0', currency: p.currency };
			}
			// Account set with no amount, or neither → omit units (Beancount auto-balance posting).
			return {
				account: p.account || PLACEHOLDER_ACCOUNT,
				units
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
