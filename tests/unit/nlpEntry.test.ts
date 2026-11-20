import { expect, test } from 'vitest';
import {
	buildTransaction,
	formatBeancount,
	parseAmountToken,
	parseTranscript,
	pickBestMatch,
	refineFromMatches
} from '#lib/utils/nlpEntry';
import { makeXact as buildXact } from '../helpers/factories';

const makeXact = (payee: string, accounts: string[]) => buildXact({ payee, postings: accounts });

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
	expect(result.fromAccount).toBe('Assets:Unknown');
	expect(result.fromAccountResolved).toBe(false);
	expect(result.toAccount).not.toBe(result.fromAccount);
});

test('"at <payee> for <category>" keeps the payee and records the category as narration', () => {
	const result = parseTranscript('20 euros at lidl for groceries');

	expect(result.payee).toBe('Lidl');
	expect(result.amount).toBe(20);
	expect(result.currency).toBe('EUR');
	expect(result.toAccount).toBe('Expenses:Groceries');
	expect(result.note).toBe('groceries');
});

test('"for <what> at <who>" assigns the vendor to the payee and the purchase to the narration', () => {
	const result = parseTranscript("10 euros for tickets at brumby's");

	expect(result.payee).toBe("Brumby's");
	expect(result.note).toBe('tickets');
	expect(result.amount).toBe(10);
	expect(result.currency).toBe('EUR');

	const xact = buildTransaction(result);
	expect(formatBeancount(xact)).toContain('"Brumby\'s" "tickets"');
});

test('"for <what> to <who>" also keeps the counterparty as the payee', () => {
	const result = parseTranscript('25 euros for repairs to Bob the Builder');

	expect(result.payee).toBe('Bob the Builder');
	expect(result.note).toBe('repairs');
});

test('a category-only "for" phrase names the expense account, not a payee', () => {
	const result = parseTranscript('12 euros for groceries');

	expect(result.payee).toBeUndefined();
	expect(result.toAccount).toBe('Expenses:Groceries');
	expect(result.note).toBe('groceries');
	expect(result.needsReview).toBe(true);
});

test('a category "for" phrase survives the account guess as narration', () => {
	const result = parseTranscript("10 euros for coffee at brumby's");

	expect(result.payee).toBe("Brumby's");
	expect(result.toAccount).toBe('Expenses:Hospitality:Drinks');
	expect(result.note).toBe('coffee');
});

test('a "for" phrase naming a business is still the payee when no vendor preposition is present', () => {
	const result = parseTranscript('10 euros for Decathlon');

	expect(result.payee).toBe('Decathlon');
	expect(result.note).toBeUndefined();
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
	expect(result.toAccount).toBe('Expenses:Unknown');
	expect(result.fromAccount).toBe('Assets:Unknown');
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
	expect(result.toAccount).toBe('Expenses:Unknown');
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

	expect(result.toAccount).toBe('Expenses:Unknown');
	expect(result.fromAccount).toBe('Assets:Unknown');
	expect(result.needsReview).toBe(true);
});

test('digits inside an account-like token are not picked as the bare amount', () => {
	const result = parseTranscript('lidl n26 22');

	expect(result.amount).toBe(22);
	expect(result.payee).toBe('Lidl N26');
});

test('unrecognized trailing words are kept as a note instead of silently dropped', () => {
	const result = parseTranscript('10 euros for Decathlon, t-shirt');

	expect(result.payee).toBe('Decathlon');
	expect(result.note).toBe('t-shirt');
});

test('fully recognized input has no leftover note', () => {
	const result = parseTranscript('50 euro at billa');

	expect(result.note).toBeUndefined();
});

test('refineFromMatches recovers input words dropped when the payee is replaced by a search match', () => {
	const result = parseTranscript('deca t-shirt');
	expect(result.payee).toBe('Deca T-shirt');
	expect(result.note).toBeUndefined();

	const match = makeXact('Decathlon', ['Expenses:Clothing', 'Assets:Checking']);
	refineFromMatches(result, [match]);

	expect(result.payee).toBe('Decathlon');
	expect(result.note).toBe('t-shirt');
});

test('a query with no search matches still builds a follow-up transaction carrying the note', () => {
	const result = parseTranscript('10 euros for Decathlon, t-shirt');
	refineFromMatches(result, []);
	const xact = buildTransaction(result);

	expect(xact.payee).toBe('Decathlon');
	expect(xact.note).toBe('t-shirt');
	expect(xact.flag).toBe('!');
});

// --- Locale-aware amounts ---

test('parseAmountToken reads a plain integer and a plain decimal', () => {
	expect(parseAmountToken('25')).toBe(25);
	expect(parseAmountToken('25.50')).toBe(25.5);
	expect(parseAmountToken('25,50')).toBe(25.5);
});

test('parseAmountToken treats the last separator as decimal when both are present', () => {
	// Continental grouping: dots group, comma is the decimal point.
	expect(parseAmountToken('1.500,50')).toBe(1500.5);
	// Anglo grouping: commas group, dot is the decimal point.
	expect(parseAmountToken('1,500.50')).toBe(1500.5);
	expect(parseAmountToken('1.234.567,89')).toBe(1234567.89);
});

test('parseAmountToken treats a repeated separator as grouping', () => {
	expect(parseAmountToken('1.500.000')).toBe(1500000);
	expect(parseAmountToken('1,500,000')).toBe(1500000);
});

test('parseAmountToken reads a lone three-digit group as thousands, not a decimal', () => {
	expect(parseAmountToken('1.500')).toBe(1500);
	expect(parseAmountToken('1,500')).toBe(1500);
});

test('parseAmountToken keeps a leading-zero fraction as a decimal', () => {
	expect(parseAmountToken('0.500')).toBe(0.5);
	expect(parseAmountToken('0,500')).toBe(0.5);
});

test('parseAmountToken returns undefined for a token with no digits', () => {
	expect(parseAmountToken('euros')).toBeUndefined();
});

test('a thousands-separated amount is not truncated at the first separator', () => {
	const result = parseTranscript('paid 1.500,50 euros at billa');

	expect(result.amount).toBe(1500.5);
	expect(result.currency).toBe('EUR');
	expect(result.payee).toBe('Billa');
});

test('an anglo-grouped amount with a currency symbol parses whole', () => {
	const result = parseTranscript('paid $1,500.50 at billa');

	expect(result.amount).toBe(1500.5);
	expect(result.currency).toBe('USD');
});

test('a bare grouped amount is not truncated either', () => {
	const result = parseTranscript('billa 1.500');

	expect(result.amount).toBe(1500);
});

// --- Default currency ---

test('an amount with no currency word uses the caller default', () => {
	const result = parseTranscript('50 at billa', { defaultCurrency: 'USD' });

	expect(result.amount).toBe(50);
	expect(result.currency).toBe('USD');
});

test('an explicit currency word still wins over the caller default', () => {
	const result = parseTranscript('50 euros at billa', { defaultCurrency: 'USD' });

	expect(result.currency).toBe('EUR');
});

test('the default currency is normalised to upper case', () => {
	const result = parseTranscript('50 at billa', { defaultCurrency: ' usd ' });

	expect(result.currency).toBe('USD');
});

test('the default currency reaches the built transaction posting', () => {
	const result = parseTranscript('50 at billa', { defaultCurrency: 'USD' });
	const xact = buildTransaction(result, { defaultCurrency: 'USD' });

	expect(xact.postings[0]?.currency).toBe('USD');
});

test('with no options the parser keeps its EUR default', () => {
	const result = parseTranscript('50 at billa');

	expect(result.currency).toBe('EUR');
	expect(buildTransaction(result).postings[0]?.currency).toBe('EUR');
});
