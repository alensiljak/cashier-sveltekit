/**
 * Model factories for unit/component tests. Model classes initialise
 * themselves with empty defaults, so tests only state what they care about.
 */
import { Account, Money, Posting, Xact } from '$lib/data/model';

export function makePosting(overrides: Partial<Posting> = {}): Posting {
	return Object.assign(new Posting(), overrides);
}

/**
 * Builds a transaction. `postings` may be plain overrides or, as a
 * shorthand, bare account names.
 */
export function makeXact(
	overrides: Partial<Omit<Xact, 'postings'>> & { postings?: (Partial<Posting> | string)[] } = {}
): Xact {
	const { postings = [], ...rest } = overrides;
	const xact = Object.assign(new Xact(), rest);
	xact.postings = postings.map((p) => makePosting(typeof p === 'string' ? { account: p } : p));
	return xact;
}

/** Builds an account, optionally holding a single-currency balance. */
export function makeAccount(
	name: string,
	balance?: { quantity: number; currency: string }
): Account {
	const account = new Account(name);
	if (balance) {
		const money = new Money();
		money.quantity = balance.quantity;
		money.currency = balance.currency;
		account.balance = money;
	}
	return account;
}
