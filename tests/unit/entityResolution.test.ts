import { describe, expect, test } from 'vitest';
import {
	aggregateAccounts,
	applyAlternative,
	matchAccountName,
	matchPayee,
	resolveEntities,
	type EntityLookup,
	type PostingObservation
} from '#lib/utils/entityResolution';
import { parseTranscript } from '#lib/utils/nlpEntry';

const NOW = new Date('2026-11-20');

/** `n` recent postings on `account`. */
function obs(account: string, n: number, amount?: number): PostingObservation[] {
	return Array.from({ length: n }, () => ({ account, date: '2026-11-01', amount }));
}

function lookupOf(data: {
	payees?: string[];
	accounts?: string[];
	history?: Record<string, PostingObservation[]>;
}): EntityLookup {
	return {
		listPayees: async () => data.payees ?? [],
		listAccounts: async () => data.accounts ?? [],
		payeePostings: async (payee) => data.history?.[payee] ?? []
	};
}

const BOOK_ACCOUNTS = [
	'Assets:Bank:N26',
	'Assets:Bank:Checking',
	'Assets:Bank:Savings',
	'Expenses:Food:Groceries',
	'Expenses:Auto:Electricity'
];

async function resolve(text: string, lookup: EntityLookup) {
	const result = parseTranscript(text);
	await resolveEntities(result, text, lookup, NOW);
	return result;
}

describe('matchPayee', () => {
	test('exact match scores 1', () => {
		expect(matchPayee(['Lidl'], ['Billa', 'Lidl'])).toMatchObject({ name: 'Lidl', score: 1 });
	});

	test('a one-letter mishearing still matches', () => {
		expect(matchPayee(['Reve'], ['Rewe', 'Billa'])?.name).toBe('Rewe');
	});

	test('a prefix matches the longer name', () => {
		expect(matchPayee(['Deca'], ['Decathlon', 'Billa'])?.name).toBe('Decathlon');
	});

	test('matches one word of a multi-word name', () => {
		expect(matchPayee(['Rewe'], ['REWE Markt'])?.name).toBe('REWE Markt');
	});

	test('diacritics and case are ignored', () => {
		expect(matchPayee(['cafe'], ['Café Central'])?.name).toBe('Café Central');
	});

	test('reports which words were consumed', () => {
		const match = matchPayee(['Deca', 't-shirt'], ['Decathlon']);
		expect(match).toMatchObject({ name: 'Decathlon', start: 0, end: 1 });
	});

	test('unrelated words do not match', () => {
		expect(matchPayee(['Zorblax'], ['Lidl', 'Billa', 'Decathlon'])).toBeUndefined();
	});
});

describe('matchAccountName', () => {
	test('finds an account by a segment name', () => {
		expect(matchAccountName('Savings', BOOK_ACCOUNTS)).toMatchObject({
			account: 'Assets:Bank:Savings',
			kind: 'exact'
		});
	});

	test('matches a stem ("grocery" -> Groceries)', () => {
		expect(matchAccountName('grocery', BOOK_ACCOUNTS)?.account).toBe('Expenses:Food:Groceries');
	});

	test('reports rivals as ambiguous', () => {
		const found = matchAccountName('bank', BOOK_ACCOUNTS);
		expect(found?.kind).toBe('ambiguous');
		expect(found?.alternatives.length).toBeGreaterThan(1);
	});

	test('returns undefined when nothing fits', () => {
		expect(matchAccountName('crypto', BOOK_ACCOUNTS)).toBeUndefined();
	});
});

describe('aggregateAccounts', () => {
	test('counts, keeps the latest date and the median amount per account', () => {
		const stats = aggregateAccounts(
			[
				{ account: 'Expenses:A', date: '2026-01-01', amount: 10 },
				{ account: 'Expenses:A', date: '2026-03-01', amount: -30 },
				{ account: 'Expenses:A', date: '2026-02-01', amount: 20 },
				{ account: 'Assets:B', date: '2026-02-01', amount: 5 }
			],
			['Expenses:']
		);
		expect(stats).toEqual([
			{ account: 'Expenses:A', count: 3, lastDate: '2026-03-01', typicalAmount: 20 }
		]);
	});
});

describe('resolveEntities: one payee, several accounts (Lidl)', () => {
	const lidl = lookupOf({
		payees: ['Lidl', 'Billa'],
		accounts: BOOK_ACCOUNTS,
		history: {
			Lidl: [
				...obs('Expenses:Food:Groceries', 10),
				...obs('Expenses:Auto:Electricity', 3),
				...obs('Assets:Bank:N26', 13)
			]
		}
	});

	test('a context word picks the account it names', async () => {
		const groceries = await resolve('20 euros at lidl for groceries', lidl);
		expect(groceries.toAccount).toBe('Expenses:Food:Groceries');
		expect(groceries.resolution?.toAccount?.kind).toBe('exact');

		const power = await resolve('40 euros at lidl for electricity', lidl);
		expect(power.toAccount).toBe('Expenses:Auto:Electricity');
		expect(power.resolution?.toAccount?.kind).toBe('exact');
	});

	test('with no context, a clear leader is picked without review', async () => {
		const result = await resolve('20 euros at lidl', lidl);
		expect(result.toAccount).toBe('Expenses:Food:Groceries');
		expect(result.resolution?.toAccount?.kind).toBe('guessed');
		expect(result.fromAccount).toBe('Assets:Bank:N26');
		expect(result.needsReview).toBe(false);
	});

	test('with no clear leader, the choice is ambiguous and needs review', async () => {
		const split = lookupOf({
			payees: ['Lidl'],
			accounts: BOOK_ACCOUNTS,
			history: {
				Lidl: [
					...obs('Expenses:Food:Groceries', 6),
					...obs('Expenses:Auto:Electricity', 5),
					...obs('Assets:Bank:N26', 11)
				]
			}
		});
		const result = await resolve('20 euros at lidl', split);
		expect(result.resolution?.toAccount?.kind).toBe('ambiguous');
		expect(result.resolution?.toAccount?.alternatives).toEqual([
			'Expenses:Food:Groceries',
			'Expenses:Auto:Electricity'
		]);
		expect(result.needsReview).toBe(true);

		applyAlternative(result, 'toAccount', 'Expenses:Auto:Electricity');
		expect(result.toAccount).toBe('Expenses:Auto:Electricity');
		expect(result.needsReview).toBe(false);
	});

	test('the typical amount nudges the choice', async () => {
		const priced = lookupOf({
			payees: ['Lidl'],
			accounts: BOOK_ACCOUNTS,
			history: {
				Lidl: [
					...obs('Expenses:Food:Groceries', 5, 25),
					...obs('Expenses:Auto:Electricity', 5, 80),
					...obs('Assets:Bank:N26', 10)
				]
			}
		});
		const result = await resolve('80 euros at lidl', priced);
		expect(result.toAccount).toBe('Expenses:Auto:Electricity');
	});
});

describe('resolveEntities: payee', () => {
	test('a misheard payee is corrected and its words are not duplicated', async () => {
		const result = await resolve(
			'15 euros at reve',
			lookupOf({ payees: ['Rewe'], accounts: BOOK_ACCOUNTS })
		);
		expect(result.payee).toBe('Rewe');
		expect(result.resolution?.payee?.kind).toBe('fuzzy');
	});

	test('words outside the matched payee move to the note', async () => {
		const result = await resolve(
			'10 euros at deca t-shirt',
			lookupOf({ payees: ['Decathlon'], accounts: BOOK_ACCOUNTS })
		);
		expect(result.payee).toBe('Decathlon');
		expect(result.note).toContain('t-shirt');
	});

	test('an unknown payee is left as spoken', async () => {
		const result = await resolve('10 euros at zorblax', lookupOf({ payees: ['Lidl'] }));
		expect(result.payee).toBe('Zorblax');
		expect(result.resolution?.payee).toBeUndefined();
	});
});

describe('resolveEntities: accounts named by the parser', () => {
	test('a keyword guess missing from the book is looked up by name', async () => {
		const result = await resolve(
			'15 euros groceries at billa',
			lookupOf({ payees: [], accounts: BOOK_ACCOUNTS })
		);
		expect(result.toAccount).toBe('Expenses:Food:Groceries');
	});

	test('an explicit "from" account is looked up by name', async () => {
		const result = await resolve(
			'12 euros from checking at billa',
			lookupOf({ payees: [], accounts: BOOK_ACCOUNTS })
		);
		expect(result.fromAccount).toBe('Assets:Bank:Checking');
	});

	test('a transfer resolves both sides and has no payee', async () => {
		const result = await resolve(
			'transferred 100 euros from checking to savings',
			lookupOf({ payees: ['Savings'], accounts: BOOK_ACCOUNTS })
		);
		expect(result.fromAccount).toBe('Assets:Bank:Checking');
		expect(result.toAccount).toBe('Assets:Bank:Savings');
		expect(result.payee).toBeUndefined();
	});

	test('with no ledger data the parse is left alone', async () => {
		const before = parseTranscript('15 euros groceries at billa');
		const after = await resolve('15 euros groceries at billa', lookupOf({}));
		expect(after.toAccount).toBe(before.toAccount);
		expect(after.fromAccount).toBe(before.fromAccount);
		expect(after.resolution).toBeUndefined();
	});
});
