/*
	Term parsing for the /search page (BQL-backed entity search across payees,
	accounts, narration, and commodities). Distinct from `fullTextSearch.ts`,
	which does plain-text grepping over OPFS files for /search/full-text.
*/
import type { EntitySearchScope } from '$lib/data/mainStore';

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
