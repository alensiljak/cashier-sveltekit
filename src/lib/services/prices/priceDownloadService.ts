/**
 * Price Download service (doc/projects/2026-11-15_price-download.md).
 *
 * Orchestrates: config from shared settings → book-relevant symbol plan →
 * provider fetch → deterministic file write (overwrite or append) → device
 * status update → background ledger reload (the standard file-mutation
 * pattern, so reports/net worth and the home staleness indicator refresh).
 *
 * Direction handling: rates are written in the provider's native direction
 * (ECB: EUR-base) unless the book already maintains a series for that pair,
 * which may run in the opposite direction (`price USD 0.9 EUR` style). A
 * second opposite-direction series would be silently ignored by the engine
 * (it coalesces both directions, denser wins), so such rates are inverted and
 * written into the book's own series direction instead — extending it with
 * new fixing dates rather than fighting it.
 */

import { PRICES_DEFAULT_DESTINATION } from '#lib/constants';
import { settings, deviceSettings, SettingKeys, DeviceSettingKeys } from '#lib/settings';
import fullLedgerService from '#lib/services/ledgerWorkerClient';
import { readFile, saveFile } from '#lib/utils/opfslib';
import { reloadLedgerFromOpfs } from '#lib/services/ledgerReload';
import type { PriceProvider } from './priceProvider';
import { getPriceProvider, defaultPriceProvider } from './priceProviderRegistry';
import {
	derivePriceSymbols,
	fetchBookPricePairs,
	fetchAccountCurrencies,
	fetchDeclaredSecurities,
	type PricePair
} from './priceCurrencies';
import { buildPriceFile, mergePriceFile, parsePriceFile, toDirectives } from './priceFileService';

export type PriceWriteMode = 'overwrite' | 'append';

export interface PriceDownloadConfig {
	providerId: string;
	targetFile: string;
	writeMode: PriceWriteMode;
}

export interface PriceDownloadPlan {
	provider: PriceProvider;
	config: PriceDownloadConfig;
	/** Symbols written in the provider's native direction (provider.base → symbol). */
	symbols: string[];
	/** Symbols written inverted (symbol → provider.base), in the book's series direction. */
	invertedSymbols: string[];
	/** Currency candidates without a provider rate. */
	skippedUnsupported: string[];
	/** Securities among the book's candidates — not exchange rates. */
	securities: string[];
}

export interface PriceDownloadStatus {
	lastRun: string;
	fixingDate: string;
	added: number;
	updated: number;
	symbols: string[];
	invertedSymbols: string[];
	skippedUnsupported: string[];
	securities: string[];
	targetFile: string;
	writeMode: PriceWriteMode;
	lastError: string | null;
}

export interface PriceDownloadResult {
	fixingDate: string;
	targetFile: string;
	writeMode: PriceWriteMode;
	added: number;
	updated: number;
	directives: number;
	symbols: string[];
	invertedSymbols: string[];
	skippedUnsupported: string[];
	securities: string[];
}

export async function resolveConfig(): Promise<PriceDownloadConfig> {
	const [providerId, targetFile, writeMode] = await Promise.all([
		settings.get<string>(SettingKeys.priceProvider),
		settings.get<string>(SettingKeys.priceTargetFile),
		settings.get<PriceWriteMode>(SettingKeys.priceWriteMode)
	]);
	return {
		providerId: providerId ?? defaultPriceProvider().id,
		targetFile: targetFile ?? PRICES_DEFAULT_DESTINATION,
		writeMode: writeMode === 'append' ? 'append' : 'overwrite'
	};
}

export async function saveConfig(config: PriceDownloadConfig): Promise<void> {
	await settings.set(SettingKeys.priceProvider, config.providerId);
	await settings.set(SettingKeys.priceTargetFile, config.targetFile);
	await settings.set(SettingKeys.priceWriteMode, config.writeMode);
}

/** Compute what a download run would do right now, without fetching anything. */
export async function planDownload(configArg?: PriceDownloadConfig): Promise<PriceDownloadPlan> {
	const config = configArg ?? (await resolveConfig());
	const provider = getPriceProvider(config.providerId);

	await fullLedgerService.ensureLoaded();
	const [defaultCurrency, operating, bookPairs, accountCurrencies, declaredSecurities] =
		await Promise.all([
			settings.get<string>(SettingKeys.currency),
			fullLedgerService.getOperatingCurrencies(),
			fetchBookPricePairs(),
			fetchAccountCurrencies(),
			fetchDeclaredSecurities()
		]);

	// Direction priority: the user's own series (outside the destination
	// file) first, then pairs this app itself wrote earlier — so a
	// hand-maintained series decides the direction, and previous downloads
	// just keep extending it.
	const destination = await readFile(config.targetFile);
	const destinationKeys = new Set<string>();
	const destinationPairs: PricePair[] = [];
	if (destination !== undefined) {
		for (const directive of parsePriceFile(destination).directives.values()) {
			destinationPairs.push({ base: directive.base, quote: directive.quote });
			destinationKeys.add(`${directive.base}/${directive.quote}`);
		}
	}
	const otherPairs = bookPairs.filter((p) => !destinationKeys.has(`${p.base}/${p.quote}`));

	const plan = derivePriceSymbols({
		base: provider.base,
		defaultCurrency,
		operatingCurrencies: operating,
		pairCurrencies: bookPairs.flatMap((p) => [p.base, p.quote]),
		accountCurrencies,
		ownedPairs: [...otherPairs, ...destinationPairs],
		declaredSecurities,
		covers: (symbol) => provider.covers(symbol)
	});

	return { provider, config, ...plan };
}

export async function getDownloadStatus(): Promise<PriceDownloadStatus | null> {
	return deviceSettings.get<PriceDownloadStatus>(DeviceSettingKeys.priceDownloadStatus);
}

/**
 * Run a download. Throws on fetch/validation failure (the target file is
 * left untouched); never a partial write.
 */
export async function downloadPrices(
	configArg?: PriceDownloadConfig
): Promise<PriceDownloadResult> {
	const config = configArg ?? (await resolveConfig());
	const provider = getPriceProvider(config.providerId);
	try {
		const plan = await planDownload(config);
		const toFetch = [...plan.symbols, ...plan.invertedSymbols];
		if (toFetch.length === 0) {
			// Nothing to fetch — not an error; the page explains why.
			return planToResult(plan, '', 0, 0, 0);
		}

		const fetched = await provider.fetchLatest(toFetch);
		const incoming = toDirectives(fetched, plan.invertedSymbols, provider.base);

		const existing = await readFile(config.targetFile);
		let text: string;
		let added: number;
		let updated: number;
		if (config.writeMode === 'overwrite') {
			text = buildPriceFile(incoming, provider.name, fetched.asOf);
			added = incoming.length;
			updated = 0;
		} else {
			const merged = mergePriceFile(existing ?? '', incoming);
			text = merged.text;
			added = merged.added;
			updated = merged.updated;
		}
		await saveFile(config.targetFile, text);
		const directives =
			config.writeMode === 'overwrite'
				? incoming.length
				: [...parsePriceFile(text).directives.keys()].length;

		const result: PriceDownloadResult = {
			fixingDate: fetched.asOf,
			targetFile: config.targetFile,
			writeMode: config.writeMode,
			added,
			updated,
			directives,
			symbols: plan.symbols,
			invertedSymbols: plan.invertedSymbols,
			skippedUnsupported: plan.skippedUnsupported,
			securities: plan.securities
		};

		await deviceSettings.set(DeviceSettingKeys.priceDownloadStatus, {
			lastRun: new Date().toISOString(),
			...result,
			lastError: null
		} satisfies PriceDownloadStatus);

		// Standard file-mutation pattern: reload in the background so queries,
		// reports and the staleness indicator pick up the new prices.
		void reloadLedgerFromOpfs();

		return result;
	} catch (err) {
		// Record the failure for the status card, then re-throw to the caller.
		const status: PriceDownloadStatus = {
			lastRun: new Date().toISOString(),
			fixingDate: '',
			added: 0,
			updated: 0,
			symbols: [],
			invertedSymbols: [],
			skippedUnsupported: [],
			securities: [],
			targetFile: config.targetFile,
			writeMode: config.writeMode,
			lastError: String(err)
		};
		await deviceSettings.set(DeviceSettingKeys.priceDownloadStatus, status);
		throw err;
	}
}

function planToResult(
	plan: PriceDownloadPlan,
	fixingDate: string,
	added: number,
	updated: number,
	directives: number
): PriceDownloadResult {
	return {
		fixingDate,
		targetFile: plan.config.targetFile,
		writeMode: plan.config.writeMode,
		added,
		updated,
		directives,
		symbols: plan.symbols,
		invertedSymbols: plan.invertedSymbols,
		skippedUnsupported: plan.skippedUnsupported,
		securities: plan.securities
	};
}
