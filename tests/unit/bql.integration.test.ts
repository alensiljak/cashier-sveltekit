/*
    Integration: BQL quoting and search-term escaping against the real ledger
    engine (WASM). String-level tests cannot show that the engine reads a
    literal the way we intend.
*/
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureInitialized, queryMultiFile } from '#lib/services/rustledger';
import { buildConditions } from '#lib/services/entitySearchService';
import { BQL_NEVER_MATCH, bqlStringLiteral, escapeRegExp } from '#lib/utils/bql';
import { parseEntitySearchTerms, txSearchParams } from '#lib/utils/entitySearch';

const BOOK = `
2020-01-01 open Assets:Cash
2020-01-01 open Expenses:Misc

2020-01-02 * "O'Neil" "c++ book (used) a\\"b"
  Expenses:Misc   10 BRK.B
  Assets:Cash    -10 BRK.B

2020-01-03 * "Shop" "plain"
  Expenses:Misc    5 BRKXB
  Assets:Cash     -5 BRKXB
`;

/** Payees of the postings matching `where`. */
function payees(where: string): string[] {
	const result = queryMultiFile(
		{ 'book.bean': BOOK },
		'book.bean',
		`SELECT DISTINCT payee WHERE ${where}`
	);
	expect(result.errors, where).toEqual([]);
	return (result.rows as unknown[][]).map((row) => String(row[0]));
}

/** `field ~ pattern`, with the pattern quoted as a BQL literal. */
const matches = (field: string, pattern: string) => `${field} ~ ${bqlStringLiteral(pattern)}`;

beforeAll(async () => {
	await ensureInitialized();
});

describe('BQL string literals in the engine', () => {
	it('matches a value containing a single quote', () => {
		expect(payees(`payee IN (${bqlStringLiteral("O'Neil")})`)).toEqual(["O'Neil"]);
	});

	it('matches a value containing a double quote', () => {
		expect(payees(matches('narration', 'a"b'))).toEqual(["O'Neil"]);
	});

	it('passes backslashes through to the regex', () => {
		expect(payees(matches('narration', 'c\\+\\+'))).toEqual(["O'Neil"]);
	});

	it('never matches with the fallback literal', () => {
		expect(payees(`payee ~ ${BQL_NEVER_MATCH}`)).toEqual([]);
	});
});

describe('search terms are literal text', () => {
	it.each(['foo)', '(unclosed', '*', 'a\\'])('%s is not an invalid regex', (term) => {
		expect(payees(matches('narration', escapeRegExp(term)))).toEqual([]);
	});

	it('does not treat "." as a wildcard', () => {
		const conditions = buildConditions(parseEntitySearchTerms('brk.b'), ['commodity'], 'commodity');

		expect(payees(conditions.join(' AND '))).toEqual(["O'Neil"]);
	});

	it('matches brackets literally', () => {
		const conditions = buildConditions(parseEntitySearchTerms('(used)'), ['any'], 'narration');

		expect(payees(conditions.join(' AND '))).toEqual(["O'Neil"]);
	});
});

describe('transaction search link', () => {
	it('keeps one parameter per term, so their order does not matter', () => {
		const params = txSearchParams(
			[
				{ value: 'book', category: 'any' },
				{ value: 'c++', category: 'any' }
			],
			[]
		);

		const patterns = params.getAll('q');
		expect(patterns).toHaveLength(2);
		expect(payees(patterns.map((p) => matches('narration', p)).join(' AND '))).toEqual(["O'Neil"]);
	});

	it('also matches symbols found through commodity metadata', () => {
		const params = txSearchParams(
			[{ value: 'berkshire', category: 'commodity' }],
			[{ currency: 'BRK.B', meta: { name: 'Berkshire Hathaway' } }]
		);

		expect(payees(matches('currency', params.get('commodity')!))).toEqual(["O'Neil"]);
	});
});
