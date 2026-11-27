/*
	Term parsing for the /search page (BQL-backed entity search across payees,
	accounts, narration, and commodities). Distinct from `fullTextSearch.ts`,
	which does plain-text grepping over OPFS files for /search/full-text.
*/
import type { EntitySearchScope } from '#lib/data/mainStore';
import { escapeRegExp } from '#lib/utils/bql';

/** A single search category a term can be pinned to. 'any' means "let the radio scope decide". */
export type EntityCategory = 'payee' | 'account' | 'narration' | 'commodity' | 'any';

/** One-character prefixes that pin a term to a category regardless of the radio group. */
const PREFIX_CATEGORY: Record<string, EntityCategory> = {
	'@': 'payee',
	'#': 'account',
	'~': 'narration',
	$: 'commodity'
};

export interface EntitySearchTerm {
	/** Lower-cased term text, prefix stripped. */
	value: string;
	/** Category this term is pinned to. 'any' defers to the current radio scope. */
	category: EntityCategory;
	/** True if the term carried an explicit prefix (took priority over the radio group). */
	explicit: boolean;
}

/** Splits a search box value on whitespace into parsed, lower-cased terms. */
export function parseEntitySearchTerms(searchTerm: string): EntitySearchTerm[] {
	return searchTerm
		.split(/\s+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 0)
		.map((raw) => {
			const prefix = raw[0];
			const category = PREFIX_CATEGORY[prefix];
			if (category && raw.length > 1) {
				return { value: raw.slice(1).toLowerCase(), category, explicit: true };
			}
			return { value: raw.toLowerCase(), category: 'any' as const, explicit: false };
		});
}

const SCOPE_TO_CATEGORY: Record<Exclude<EntitySearchScope, 'all'>, EntityCategory> = {
	payees: 'payee',
	accounts: 'account',
	narration: 'narration',
	commodities: 'commodity'
};

/** The part of a `commodity` directive that search looks at. */
export interface SearchableCommodity {
	currency: string;
	meta?: Record<string, unknown>;
}

/**
 * Meta keys that are never searched. `price` is price-source configuration
 * (e.g. "EUR:ecbrates/USD-EUR"), so searching "eur" would match every
 * commodity quoted in EUR.
 */
const UNSEARCHED_META_KEYS = new Set(['price']);

export interface MetaEntry {
	key: string;
	value: string;
}

/** The searchable metadata of a commodity, with values as text. */
function searchableMeta(commodity: SearchableCommodity): MetaEntry[] {
	return Object.entries(commodity.meta ?? {})
		.filter(
			([key, value]) =>
				!UNSEARCHED_META_KEYS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)
		)
		.map(([key, value]) => ({ key, value: String(value) }));
}

/** Metadata entries whose value contains any of the (lower-cased) term values. */
export function matchingMeta(commodity: SearchableCommodity, termValues: string[]): MetaEntry[] {
	return searchableMeta(commodity).filter(({ value }) => {
		const lower = value.toLowerCase();
		return termValues.some((term) => lower.includes(term));
	});
}

/** Symbols of the commodities having a metadata value that contains `termValue`. */
export function symbolsMatchingMeta(
	commodities: SearchableCommodity[],
	termValue: string
): string[] {
	return commodities.filter((c) => matchingMeta(c, [termValue]).length > 0).map((c) => c.currency);
}

/**
 * Symbols of declared commodities where every term is found in the symbol or in a
 * metadata value. Covers commodities which no posting uses, so BQL can't return them.
 */
export function searchDeclaredCommodities(
	commodities: SearchableCommodity[],
	termValues: string[]
): string[] {
	if (termValues.length === 0) return [];
	return commodities
		.filter((c) =>
			termValues.every(
				(term) => c.currency.toLowerCase().includes(term) || matchingMeta(c, [term]).length > 0
			)
		)
		.map((c) => c.currency);
}

/**
 * Query parameters for /reports/tx-search, repeating the current transaction search.
 * Each term gets its own parameter (`q`, `account` or `commodity`), because that page
 * ANDs one condition per value. Its values are regexes, so the terms are escaped.
 * A commodity term also matches the symbols whose metadata matched it. An 'any' term
 * goes to `q`, which searches the payee as well as the narration.
 */
export function txSearchParams(
	terms: { value: string; category: EntityCategory }[],
	commodities: SearchableCommodity[]
): URLSearchParams {
	const params = new URLSearchParams();
	for (const { value, category } of terms) {
		const pattern = escapeRegExp(value);
		if (category === 'account') {
			params.append('account', pattern);
		} else if (category === 'commodity') {
			const symbols = symbolsMatchingMeta(commodities, value).map(escapeRegExp);
			params.append(
				'commodity',
				symbols.length > 0 ? `${pattern}|^(${symbols.join('|')})$` : pattern
			);
		} else {
			params.append('q', pattern);
		}
	}
	return params;
}

/**
 * Resolves each term's effective category: an explicit prefix always wins;
 * otherwise the term falls back to the radio group's scope ('all' keeps it
 * as 'any', matching every implemented category).
 */
export function resolveTermCategories(
	terms: EntitySearchTerm[],
	radioScope: EntitySearchScope
): EntityCategory[] {
	const fallback: EntityCategory = radioScope === 'all' ? 'any' : SCOPE_TO_CATEGORY[radioScope];
	return terms.map((term) => (term.explicit ? term.category : fallback));
}
