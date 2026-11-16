/**
 * Aware Super unit prices.
 *
 *   GET https://api.aware.com.au/experience/web/investments/lager/api/microsite/v1/products/{PRODUCT}/unitprices
 *     → { effectiveDate: "2026-11-13",
 *         investmentOptions: [{ investmentOptionId: "42000100",
 *                               investmentOptionName: "High Growth",
 *                               unitPrices: [{ date: "2026-11-13", value: 12.881781 }, …] }] }
 *
 * One request returns every option with about a month of daily prices
 * (weekends repeat the Friday price), so the latest price of an option is its
 * newest `unitPrices` entry.
 *
 * The API needs the site's key in `X-API-KEY`. The user pastes it into the
 * provider's settings; it lives in device settings only, is sent to the app's
 * CORS proxy as `X-Upstream-Key`, and the proxy forwards it to this host alone.
 *
 * A book commodity links to an option through its `price` meta:
 * `AUD:aware/<investmentOptionId>` (names contain spaces, which the `price`
 * grammar does not allow, so the numeric id is the symbol). Only the default
 * source nickname `aware` is recognised when planning a download.
 */

import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { parsePriceMeta } from './bookPricePlan';
import type {
	CatalogueProduct,
	DeclaredCommodity,
	FetchedQuotes,
	PriceProvider,
	PriceQuote,
	PriceSpec
} from './priceProvider';
import { proxyFetch } from './proxyFetch';
import { UPSTREAM_KEY_HEADER } from './proxyProtocol';

/** Aware account type whose options are listed. Others (e.g. retirement) can be added later. */
export const AWARE_PRODUCT = 'FUTURE_SAVER';
/** The `source` in a commodity's `price` meta that selects this provider. */
export const AWARE_NICKNAME = 'aware';

export function awareUnitPricesUrl(product: string = AWARE_PRODUCT): string {
	return `https://api.aware.com.au/experience/web/investments/lager/api/microsite/v1/products/${product}/unitprices`;
}

/** Option ids are numeric strings (`42000100`). */
const OPTION_ID = /^\d+$/;
/** Calendar-valid ISO date. */
const ISO_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export interface AwareOption {
	id: string;
	name: string;
	/** Newest price in the response; null when the option lists none. */
	latest: { date: string; rate: number } | null;
}

function recordOf(value: unknown, what: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`Aware ${what} is not an object`);
	}
	return value as Record<string, unknown>;
}

/**
 * Parse the unit-prices response. Throws on a changed shape, so an API change
 * surfaces instead of producing an empty list.
 */
export function parseAwareOptions(body: unknown): AwareOption[] {
	const list = recordOf(body, 'unit prices response').investmentOptions;
	if (!Array.isArray(list)) throw new Error('Aware unit prices response has no investmentOptions list');

	const options: AwareOption[] = [];
	for (const [i, entry] of list.entries()) {
		const option = recordOf(entry, `investment option ${i}`);
		const { investmentOptionId, investmentOptionName, unitPrices } = option;
		const id = typeof investmentOptionId === 'number' ? String(investmentOptionId) : investmentOptionId;
		if (typeof id !== 'string' || !OPTION_ID.test(id)) {
			throw new Error(`Aware investment option ${i} has no valid investmentOptionId`);
		}
		const name =
			typeof investmentOptionName === 'string' && investmentOptionName.trim() !== ''
				? investmentOptionName.trim()
				: id;

		let latest: AwareOption['latest'] = null;
		if (unitPrices !== undefined && unitPrices !== null) {
			if (!Array.isArray(unitPrices)) {
				throw new Error(`Aware option ${id} has no unitPrices list`);
			}
			for (const [j, raw] of unitPrices.entries()) {
				const price = recordOf(raw, `option ${id} price ${j}`);
				const { date, value } = price;
				if (typeof date !== 'string' || !ISO_DATE.test(date)) {
					throw new Error(`Aware option ${id} price ${j} has no valid date`);
				}
				if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
					throw new Error(`Aware option ${id} price ${j} has no valid value`);
				}
				if (!latest || date > latest.date) latest = { date, rate: value };
			}
		}
		options.push({ id, name, latest });
	}
	if (options.length === 0) throw new Error('Aware unit prices response lists no investment options');
	return options;
}

export function parseAwareCatalogue(body: unknown): CatalogueProduct[] {
	return parseAwareOptions(body).map((o) => ({ portId: o.id, label: o.name }));
}

/** Option id from a commodity's `price` meta when it names the Aware source. */
export function awareOptionId(commodity: DeclaredCommodity): string | undefined {
	const spec = parsePriceMeta(commodity.price).specs.find((s) => s.source === AWARE_NICKNAME);
	return spec && !spec.inverted && OPTION_ID.test(spec.symbol) ? spec.symbol : undefined;
}

export async function getAwareApiKey(): Promise<string> {
	return ((await deviceSettings.get<string>(DeviceSettingKeys.awareApiKey)) ?? '').trim();
}

/** The slice of `Response` this provider needs; `proxyFetch` satisfies it. */
export interface AwareResponse {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}
export type AwareFetch = (url: string, init?: RequestInit) => Promise<AwareResponse>;

export function createAwarePriceProvider(
	fetchImpl: AwareFetch = proxyFetch,
	getKey: () => Promise<string> = getAwareApiKey
): PriceProvider {
	/** Commodity name → option id, from the last `resolveCovered`. */
	let resolved = new Map<string, string>();

	async function fetchOptions(): Promise<AwareOption[]> {
		const key = await getKey();
		if (!key) throw new Error('Enter the Aware API key first.');
		const response = await fetchImpl(awareUnitPricesUrl(), {
			headers: { [UPSTREAM_KEY_HEADER]: key }
		});
		if (response.status === 401 || response.status === 403) {
			throw new Error('Aware rejected the API key.');
		}
		if (!response.ok) {
			throw new Error(`Aware unit prices request failed: HTTP ${response.status}`);
		}
		return parseAwareOptions(await response.json());
	}

	return {
		id: 'aware',
		name: 'Aware Super (unit prices)',
		kind: 'securities',
		base: 'AUD',
		covers(symbol) {
			return resolved.has(symbol);
		},
		async fetchCatalogue() {
			return (await fetchOptions()).map((o) => ({ portId: o.id, label: o.name }));
		},
		// Linking is by `price` meta, gated by the user's selection of active options: the book's
		// commodities that name this source are the ones served.
		async resolveCovered(commodities, selection) {
				const active = new Set(selection.map((p) => p.portId));
			resolved = new Map();
			for (const commodity of commodities) {
				const id = awareOptionId(commodity);
				if (id && active.has(id)) resolved.set(commodity.name, id);
			}
			return [...resolved.keys()];
		},
		validateSpec(_commodity: string, spec: PriceSpec) {
			return OPTION_ID.test(spec.symbol)
				? null
				: `Aware symbol must be the numeric investment option id, got "${spec.symbol}"`;
		},
		async fetchLatest(symbols) {
			const wanted = symbols.map((symbol) => {
				const id = resolved.get(symbol);
				if (!id) throw new Error(`No Aware investment option for ${symbol}`);
				return { symbol, id };
			});

			const byId = new Map((await fetchOptions()).map((o) => [o.id, o]));
			const quotes: PriceQuote[] = [];
			const missing: string[] = [];
			for (const { symbol, id } of wanted) {
				const latest = byId.get(id)?.latest;
				if (!latest) {
					missing.push(symbol);
					continue;
				}
				quotes.push({ base: symbol, rate: latest.rate, quote: 'AUD', date: latest.date });
			}
			if (quotes.length === 0) {
				throw new Error('Aware returned no prices for the requested investment options');
			}
			const asOf = quotes.reduce((max, q) => ((q.date ?? '') > max ? (q.date ?? '') : max), '');
			return { source: 'aware', asOf, quotes, missing } satisfies FetchedQuotes;
		}
	};
}

export const awarePriceProvider = createAwarePriceProvider();
