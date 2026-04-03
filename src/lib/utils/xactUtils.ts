import { Posting, type Xact } from '$lib/data/model';
import { DirectiveFormatter } from '$lib/rledger/directiveFormatter';

/**
 * Convert an Xact to a Beancount transaction string using DirectiveFormatter.
 */
export function xactToBeancountText(tx: Xact): string {
	const directive = {
		type: 'transaction' as const,
		date: tx.date ?? '',
		flag: '*',
		payee: tx.payee ?? '',
		narration: tx.note ?? '',
		tags: [],
		links: [],
		postings: tx.postings
			.filter((p) => p.account)
			.map((p) => ({
				account: p.account,
				units: p.amount != null ? { number: String(p.amount), currency: p.currency } : undefined
			}))
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
