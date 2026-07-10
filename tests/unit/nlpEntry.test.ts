import { expect, test } from 'vitest';
import { parseTranscript, pickBestMatch, refineFromMatches } from '$lib/utils/nlpEntry';
import { Xact, Posting } from '$lib/data/model';

function makeXact(payee: string, accounts: string[]): Xact {
	const xact = new Xact();
	xact.payee = payee;
	xact.postings = accounts.map((account) => {
		const p = new Posting();
		p.account = account;
		return p;
	});
	return xact;
}

test('currency word is not picked as payee', () => {
	const result = parseTranscript('50 euro at billa');

	expect(result.payee).toBe('Billa');
	expect(result.amount).toBe(50);
	expect(result.currency).toBe('EUR');
});

test('expense category keyword sets toAccount, not fromAccount', () => {
	const result = parseTranscript('15 euro groceries at billa');

	expect(result.payee).toBe('Billa');
	expect(result.amount).toBe(15);
	expect(result.toAccount).toBe('Expenses:Groceries');
	expect(result.fromAccount).toBe('Assets');
	expect(result.fromAccountResolved).toBe(false);
	expect(result.toAccount).not.toBe(result.fromAccount);
});

test('"at <payee> for <category>" strips category from payee name', () => {
	const result = parseTranscript('20 euros at lidl for groceries');

	expect(result.payee).toBe('Lidl');
	expect(result.amount).toBe(20);
	expect(result.currency).toBe('EUR');
	expect(result.toAccount).toBe('Expenses:Groceries');
});

test('"car wash" two-word payee with no keyword is captured fully', () => {
	const result = parseTranscript('15 euros car wash');

	expect(result.payee).toBe('Car Wash');
	expect(result.amount).toBe(15);
	expect(result.currency).toBe('EUR');
});

test('"from <alphanumeric-name>" captures account name with digits', () => {
	const result = parseTranscript('20 euros at lidl for groceries from n26');

	expect(result.payee).toBe('Lidl');
	expect(result.amount).toBe(20);
	expect(result.currency).toBe('EUR');
	expect(result.toAccount).toBe('Expenses:Groceries');
	expect(result.fromAccount).toBe('n26');
});

test('unresolved payee/amount/accounts marks needsReview for follow-up', () => {
	const result = parseTranscript('xylophone');

	expect(result.amount).toBeUndefined();
	expect(result.toAccount).toBe('Expenses');
	expect(result.fromAccount).toBe('Assets');
	expect(result.needsReview).toBe(true);
});

test('fully resolved transaction does not need review', () => {
	const result = parseTranscript('15 euro groceries at billa from n26');

	expect(result.needsReview).toBe(false);
	expect(result.fromAccount).toBe('n26');
	expect(result.toAccount).toBe('Expenses:Groceries');
});

test('explicit from-account keyword does not leak into the toAccount category guess', () => {
	const result = parseTranscript('20 euros at Bistro Nine from savings');

	expect(result.fromAccount).toBe('Assets:Savings');
	expect(result.toAccount).toBe('Expenses');
	expect(result.toAccount).not.toBe(result.fromAccount);
});

test('pickBestMatch prefers the most frequent (payee, account-set) group over a lone more-recent one', () => {
	const common1 = makeXact('Bistro Nine', ['Expenses:Dining', 'Liabilities:CreditCard']);
	const common2 = makeXact('Bistro Nine', ['Expenses:Dining', 'Liabilities:CreditCard']);
	const rare = makeXact('Bistro Nine', ['Expenses:Travel', 'Assets:Cash']);
	// Most-recent-first order, as search results are returned.
	const best = pickBestMatch([rare, common1, common2]);

	expect(best?.postings.map((p) => p.account)).toEqual([
		'Expenses:Dining',
		'Liabilities:CreditCard'
	]);
});

test('pickBestMatch breaks frequency ties by recency (first occurrence in input order)', () => {
	const recent = makeXact('Vanguard', [
		'Assets:Investments:Brokerage:VTI',
		'Assets:Investments:Brokerage:Cash'
	]);
	const older = makeXact('Vanguard', [
		'Assets:Investments:Brokerage:BND',
		'Assets:Investments:Brokerage:Cash'
	]);

	expect(pickBestMatch([recent, older])).toBe(recent);
});

test('pickBestMatch returns undefined for an empty candidate list', () => {
	expect(pickBestMatch([])).toBeUndefined();
});

test('refineFromMatches fills payee and accounts from the best match, clearing needsReview', () => {
	const result = parseTranscript('30 euros bist nine');
	expect(result.needsReview).toBe(true);

	const match = makeXact('Bistro Nine', ['Expenses:Dining', 'Liabilities:CreditCard']);
	refineFromMatches(result, [match]);

	expect(result.payee).toBe('Bistro Nine');
	expect(result.toAccount).toBe('Expenses:Dining');
	expect(result.fromAccount).toBe('Liabilities:CreditCard');
	expect(result.toAccountResolved).toBe(true);
	expect(result.fromAccountResolved).toBe(true);
	expect(result.needsReview).toBe(false);
});

test('refineFromMatches leaves already-resolved accounts untouched', () => {
	const result = parseTranscript('15 euro groceries at billa from n26');
	const match = makeXact('Someone Else', ['Expenses:Other', 'Assets:Other']);

	refineFromMatches(result, [match]);

	expect(result.payee).toBe('Billa');
	expect(result.fromAccount).toBe('n26');
	expect(result.toAccount).toBe('Expenses:Groceries');
});

test('refineFromMatches is a no-op with no candidates', () => {
	const result = parseTranscript('xylophone');
	refineFromMatches(result, []);

	expect(result.toAccount).toBe('Expenses');
	expect(result.fromAccount).toBe('Assets');
	expect(result.needsReview).toBe(true);
});

test('digits inside an account-like token are not picked as the bare amount', () => {
	const result = parseTranscript('lidl n26 22');

	expect(result.amount).toBe(22);
	expect(result.payee).toBe('Lidl N26');
});
