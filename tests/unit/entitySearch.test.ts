/*
    Tests for the /search page's term parsing and scope resolution.
*/
import { describe, expect, it } from 'vitest';
import {
	parseEntitySearchTerms,
	resolveTermCategories,
	searchDeclaredCommodities,
	symbolsMatchingMeta
} from '#lib/utils/entitySearch';

describe('commodity metadata search', () => {
	const commodities = [
		{ currency: 'VTI', meta: { name: 'Vanguard Total Stock', isin: 'US9229087690' } },
		{ currency: 'USD', meta: { name: 'US Dollar', price: 'EUR:ecbrates/USD-EUR' } },
		{ currency: 'XYZ' }
	];

	it('matches metadata values case-insensitively, by substring', () => {
		expect(symbolsMatchingMeta(commodities, 'us92290')).toEqual(['VTI']);
	});

	it('ignores key names and the price key', () => {
		expect(symbolsMatchingMeta(commodities, 'isin')).toEqual([]);
		expect(symbolsMatchingMeta(commodities, 'ecbrates')).toEqual([]);
	});

	it('requires every term to match the symbol or a metadata value', () => {
		expect(searchDeclaredCommodities(commodities, ['vti', 'vanguard'])).toEqual(['VTI']);
		expect(searchDeclaredCommodities(commodities, ['vanguard', 'dollar'])).toEqual([]);
		expect(searchDeclaredCommodities(commodities, ['xy'])).toEqual(['XYZ']);
		expect(searchDeclaredCommodities(commodities, [])).toEqual([]);
	});
});

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
