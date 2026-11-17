/**
 * Book-driven price download service
 * (doc/projects/2026-11-16_book-driven-price-download.md).
 *
 * Loads the book's commodities, nickname map and ignore list into a
 * `BookPricePlan`, and runs "Download all": one fetch per participating
 * provider, one combined write to the configured destination file.
 *
 * Every enabled provider takes part, `fx` and securities alike. Rates are
 * written verbatim in the provider's published direction (no inversion).
 */

import fullLedgerService from '#lib/services/ledgerWorkerClient';
import { reloadLedgerFromOpfs } from '#lib/services/ledgerReload';
import { readFile, saveFile } from '#lib/utils/opfslib';
import { buildBookPricePlan, type BookPricePlan } from './bookPricePlan';
import { getDisabledProviders, getIgnored, getNicknames, saveIgnored } from './priceNicknames';
import { resolveConfig, validateTargetFile } from './priceDownloadService';
import { buildPriceFile, mergePriceFile, parsePriceFile, toDirectives } from './priceFileService';
import type { PriceDirective } from './priceFileService';
import { getPriceProvider, listPriceProviders } from './priceProviderRegistry';
import { getCatalogueSelection } from './priceCatalogueService';
import { fetchDeclaredCommodities } from './priceCurrencies';

export async function loadBookPlan(): Promise<BookPricePlan> {
	await fullLedgerService.ensureLoaded();
	const [commodities, allNicknames, ignored, disabled] = await Promise.all([
		fullLedgerService.getCommodityDirectives(),
		getNicknames(),
		getIgnored(),
		getDisabledProviders()
	]);
	// A switched-off provider keeps its nicknames but takes no part in the plan:
	// its sources read as unmapped until it is turned back on.
	const off = new Set(disabled);
	const nicknames = Object.fromEntries(
		Object.entries(allNicknames).filter(([, id]) => !off.has(id))
	);
	return buildBookPricePlan({ commodities, nicknames, ignored, providers: listPriceProviders() });
}

/** Acknowledge (or un-acknowledge) a commodity as deliberately not priced. */
export async function setCommodityIgnored(commodity: string, ignored: boolean): Promise<void> {
	const current = new Set(await getIgnored());
	if (ignored) current.add(commodity);
	else current.delete(commodity);
	await saveIgnored([...current].sort());
}

export interface BookDownloadResult {
	targetFile: string;
	/** Per provider: what was requested and what the response lacked. */
	providers: { providerId: string; asOf: string; requested: string[]; missing: string[] }[];
	added: number;
	updated: number;
	directives: number;
	unchanged: boolean;
}

export interface BookDownloadPlan {
	/** What `Download all` will fetch, per provider (insertion order = registry order of first use). */
	groups: Map<string, string[]>;
	/** Mapped to a provider that cannot serve them (e.g. a fund with no APIR, or not in the Vanguard selection). */
	uncovered: { commodity: string; providerId: string }[];
}

/**
 * Resolve the mapped commodities against each provider. Local only (the stored
 * catalogue selection and the book's metadata, never a fetch). Securities
 * providers must be resolved before `fetchLatest`, which relies on the result.
 */
export async function planBookDownload(plan: BookPricePlan): Promise<BookDownloadPlan> {
	const mappedBy = new Map<string, string[]>();
	for (const entry of plan.entries) {
		if (entry.state !== 'mapped' || !entry.providerId) continue;
		const list = mappedBy.get(entry.providerId) ?? [];
		list.push(entry.commodity);
		mappedBy.set(entry.providerId, list);
	}

	const groups = new Map<string, string[]>();
	const uncovered: BookDownloadPlan['uncovered'] = [];
	if (mappedBy.size === 0) return { groups, uncovered };

	const declared = await fetchDeclaredCommodities();
	for (const [providerId, names] of mappedBy) {
		const provider = getPriceProvider(providerId);
		let covered: Set<string>;
		if (provider.resolveCovered) {
			const selection = provider.fetchCatalogue ? await getCatalogueSelection(providerId) : [];
			covered = new Set(await provider.resolveCovered(declared, selection));
		} else {
			covered = new Set(names.filter((n) => provider.covers(n)));
		}
		const served = names.filter((n) => covered.has(n));
		if (served.length > 0) groups.set(providerId, served);
		for (const commodity of names) {
			if (!covered.has(commodity)) uncovered.push({ commodity, providerId });
		}
	}
	return { groups, uncovered };
}

/**
 * Fetch every participating provider and write one combined file. Throws
 * before writing if the destination is invalid or any provider fails — never
 * a partial write.
 */
export async function downloadAllFromBook(plan?: BookPricePlan): Promise<BookDownloadResult> {
	const config = await resolveConfig();
	const invalid = await validateTargetFile(config.targetFile);
	if (invalid) throw new Error(invalid);

	// Always re-resolved: securities providers remember it for `fetchLatest`.
	const { groups } = await planBookDownload(plan ?? (await loadBookPlan()));
	if (groups.size === 0) throw new Error('No mapped commodities to download.');

	const incoming: PriceDirective[] = [];
	const perProvider: BookDownloadResult['providers'] = [];
	const names: string[] = [];
	let latest = '';
	for (const [providerId, symbols] of groups) {
		const provider = getPriceProvider(providerId);
		const fetched = await provider.fetchLatest(symbols);
		incoming.push(...toDirectives(fetched, [], provider.base));
		perProvider.push({
			providerId,
			asOf: fetched.asOf,
			requested: symbols,
			missing: fetched.missing
		});
		names.push(provider.name);
		if (fetched.asOf > latest) latest = fetched.asOf;
	}

	const existing = await readFile(config.targetFile);
	let text: string;
	let added: number;
	let updated = 0;
	if (config.writeMode === 'overwrite') {
		text = buildPriceFile(incoming, names.join(' + '), latest);
		added = incoming.length;
	} else {
		const dropPairs = new Set(incoming.map((d) => `${d.quote}/${d.base}`));
		const merged = mergePriceFile(existing ?? '', incoming, { dropPairs });
		text = merged.text;
		added = merged.added;
		updated = merged.updated;
	}
	const unchanged = existing === text;
	if (unchanged) {
		added = 0;
		updated = 0;
	} else {
		await saveFile(config.targetFile, text);
		void reloadLedgerFromOpfs();
	}

	return {
		targetFile: config.targetFile,
		providers: perProvider,
		added,
		updated,
		directives: [...parsePriceFile(text).directives.keys()].length,
		unchanged
	};
}
