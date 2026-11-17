/**
 * Book-driven price download plan
 * (doc/projects/2026-11-16_book-driven-price-download.md).
 *
 * Reads the Beancount `price` meta on `commodity` directives
 * (`QUOTE:source/SYMBOL`, comma-separated fallbacks, `^SYMBOL` = inverted),
 * resolves each entry's `source` to a provider through a nickname map, and
 * classifies every commodity so none falls through the cracks.
 *
 * Pure: no I/O, no settings access — callers pass everything in.
 */

import type { PriceProvider, PriceSpec } from './priceProvider';

/** `QUOTE:source/SYMBOL` — source is a module path (no `/`), symbol is the rest. */
const SPEC = /^([^:\s/]+):([^/\s]+)\/(\^)?(\S+)$/;

export interface ParsedPriceMeta {
	specs: PriceSpec[];
	/** Entries that did not match the grammar, verbatim. */
	malformed: string[];
}

/**
 * Parse a `price` meta value. Non-string values are treated as malformed; an
 * absent/empty value yields no specs and nothing malformed.
 */
export function parsePriceMeta(value: unknown): ParsedPriceMeta {
	if (value === undefined || value === null) return { specs: [], malformed: [] };
	if (typeof value !== 'string') return { specs: [], malformed: [String(value)] };

	const specs: PriceSpec[] = [];
	const malformed: string[] = [];
	for (const raw of value.split(',')) {
		const entry = raw.trim();
		if (entry === '') continue;
		const m = SPEC.exec(entry);
		if (!m) {
			malformed.push(entry);
			continue;
		}
		specs.push({ quote: m[1], source: m[2], symbol: m[4], inverted: m[3] === '^' });
	}
	return { specs, malformed };
}

export type CommodityState =
	/** Tagged, nickname resolves, provider accepts it. Downloaded. */
	| 'mapped'
	/** Tagged, but no provider is mapped to the source nickname. */
	| 'unmapped-source'
	/** Tagged, but malformed or rejected by the provider. */
	| 'invalid'
	/** No `price` tag and not acknowledged — the list that must be noticed. */
	| 'untagged'
	/** No `price` tag, acknowledged as deliberately not priced. */
	| 'ignored';

export interface CommodityPlanEntry {
	commodity: string;
	state: CommodityState;
	/** The spec in use (the first entry — fallback chains are not supported yet). */
	spec?: PriceSpec;
	providerId?: string;
	/** The unmapped nickname, for `unmapped-source`. */
	source?: string;
	/** Why the entry is `invalid`. */
	reason?: string;
}

export interface BookPriceInput {
	commodities: { currency: string; meta?: Record<string, unknown> }[];
	/** nickname → provider id. */
	nicknames: Record<string, string>;
	/** Commodities acknowledged as deliberately not priced. */
	ignored: string[];
	providers: PriceProvider[];
}

export interface ProviderParticipation {
	providerId: string;
	/** Nicknames mapped to this provider. */
	nicknames: string[];
	/** Commodities that will be downloaded through it. */
	commodities: string[];
	/** True when at least one nickname maps to it. */
	included: boolean;
}

export interface BookPricePlan {
	entries: CommodityPlanEntry[];
	/** Distinct sources used in the book, with how many commodities use each. */
	sources: { source: string; count: number; providerId?: string }[];
	/** Every registered provider, flagged by whether the full download includes it. */
	providers: ProviderParticipation[];
}

export function buildBookPricePlan(input: BookPriceInput): BookPricePlan {
	const { nicknames, providers } = input;
	const ignored = new Set(input.ignored);
	const byId = new Map(providers.map((p) => [p.id, p]));
	const entries: CommodityPlanEntry[] = [];
	const sourceCounts = new Map<string, number>();

	for (const { currency, meta } of input.commodities) {
		const { specs, malformed } = parsePriceMeta(meta?.price);

		if (specs.length === 0) {
			if (malformed.length > 0) {
				entries.push({
					commodity: currency,
					state: 'invalid',
					reason: `malformed price tag: ${malformed.join(', ')}`
				});
			} else {
				entries.push({
					commodity: currency,
					state: ignored.has(currency) ? 'ignored' : 'untagged'
				});
			}
			continue;
		}

		const spec = specs[0];
		sourceCounts.set(spec.source, (sourceCounts.get(spec.source) ?? 0) + 1);

		const providerId = nicknames[spec.source];
		const provider = providerId ? byId.get(providerId) : undefined;
		if (!provider) {
			entries.push({ commodity: currency, state: 'unmapped-source', spec, source: spec.source });
			continue;
		}

		const reason = provider.validateSpec?.(currency, spec) ?? null;
		if (reason) {
			entries.push({
				commodity: currency,
				state: 'invalid',
				spec,
				providerId: provider.id,
				reason
			});
			continue;
		}
		entries.push({ commodity: currency, state: 'mapped', spec, providerId: provider.id });
	}

	const sources = [...sourceCounts].map(([source, count]) => ({
		source,
		count,
		providerId: nicknames[source]
	}));

	const participation = providers.map<ProviderParticipation>((p) => {
		const mappedNicknames = Object.entries(nicknames)
			.filter(([, id]) => id === p.id)
			.map(([nick]) => nick);
		return {
			providerId: p.id,
			nicknames: mappedNicknames,
			commodities: entries
				.filter((e) => e.state === 'mapped' && e.providerId === p.id)
				.map((e) => e.commodity),
			included: mappedNicknames.length > 0
		};
	});

	return { entries, sources, providers: participation };
}
