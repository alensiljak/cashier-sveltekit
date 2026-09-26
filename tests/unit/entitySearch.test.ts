/*
    Tests for the /search page's term parsing and scope resolution.
*/
import { describe, expect, it } from 'vitest';
import { parseEntitySearchTerms, resolveTermCategories } from '$lib/utils/entitySearch';

describe('parseEntitySearchTerms', () => {
	it.each([
		['@acme', 'payee'],
		['#assets', 'account'],
		['~rent', 'narration'],
		['$vti', 'commodity']
	])('%s pins the term to %s and strips the prefix', (raw, category) => {
		expect(parseEntitySearchTerms(raw)).toEqual([
			{ value: raw.slice(1), category, explicit: true }
		]);
	});

	it('lower-cases terms and leaves unprefixed ones to the radio scope', () => {
		expect(parseEntitySearchTerms('Groceries')).toEqual([
			{ value: 'groceries', category: 'any', explicit: false }
		]);
	});

	it('treats a lone prefix character as an ordinary term', () => {
		expect(parseEntitySearchTerms('@')).toEqual([{ value: '@', category: 'any', explicit: false }]);
	});

	it('splits several terms on any whitespace and ignores blanks', () => {
		expect(parseEntitySearchTerms('  @Acme \t #Bank  rent ').map((t) => t.value)).toEqual([
			'acme',
			'bank',
			'rent'
		]);
		expect(parseEntitySearchTerms('   ')).toEqual([]);
	});
});

describe('resolveTermCategories', () => {
	const terms = parseEntitySearchTerms('@acme plain');

	it("keeps 'any' for unprefixed terms when the scope is all", () => {
		expect(resolveTermCategories(terms, 'all')).toEqual(['payee', 'any']);
	});

	it.each([
		['payees', 'payee'],
		['accounts', 'account'],
		['narration', 'narration'],
		['commodities', 'commodity']
	] as const)('applies the %s scope to unprefixed terms', (scope, category) => {
		expect(resolveTermCategories(terms, scope)).toEqual(['payee', category]);
	});

	it('lets an explicit prefix win over the scope', () => {
		expect(resolveTermCategories(parseEntitySearchTerms('#bank'), 'payees')).toEqual(['account']);
	});
});
