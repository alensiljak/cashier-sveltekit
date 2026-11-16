/**
 * Price Download service (doc/completed-projects/2026-11-15_price-download.md).
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

import { DEMO_DIR, PRICES_DEFAULT_DESTINATION } from '#lib/constants';
import appService from '#lib/services/appService';
import { settings, deviceSettings, SettingKeys, DeviceSettingKeys } from '#lib/settings';
import fullLedgerService from '#lib/services/ledgerWorkerClient';
import { readFile, saveFile } from '#lib/utils/opfslib';
import { reloadLedgerFromOpfs } from '#lib/services/ledgerReload';
import type { PriceProvider } from './priceProvider';
import { getPriceProvider, defaultPriceProvider } from './priceProviderRegistry';
import {
	derivePriceSymbols,
	deriveSecuritySymbols,
	fetchBookPricePairs,
	fetchDeclaredCommodities,
	type PricePair,
	type SymbolPlan
} from './priceCurrencies';
import { buildPriceFile, mergePriceFile, parsePriceFile, toDirectives } from './priceFileService';

export type PriceWriteMode = 'overwrite' | 'append';

/** Symbols chosen per provider; a missing provider entry means "all candidates". */
export type PriceSymbolSelections = Record<string, string[]>;

export interface PriceDownloadConfig {
	providerId: string;
	targetFile: string;
	writeMode: PriceWriteMode;
	/**
	 * Symbols to download, or `null` for every book-relevant candidate.
	 * Persisted per provider under `SettingKeys.priceSymbols`.
	 */
	symbols: string[] | null;
}

export interface PriceDownloadPlan {
	provider: PriceProvider;
	config: PriceDownloadConfig;
	/** Every native-direction candidate, before the user's selection is applied. */
	availableSymbols: string[];
	/** Every inverted candidate, before the user's selection is applied. */
	availableInvertedSymbols: string[];
	/** Selected symbols written in the provider's native direction (provider.base → symbol). */
	symbols: string[];
	/** Selected symbols written inverted (symbol → provider.base), in the book's series direction. */
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
	removed: number;
	/** Price directives in the destination file after the run. */
	directives?: number;
	symbols: string[];
	invertedSymbols: string[];
	skippedUnsupported: string[];
	securities: string[];
	/** Requested symbols the provider's response did not contain. */
	missing: string[];
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
	/** Opposite-direction lines dropped from the destination (append mode). */
	removed: number;
	directives: number;
	symbols: string[];
	invertedSymbols: string[];
	skippedUnsupported: string[];
	securities: string[];
	/** Requested symbols the provider's response did not contain. */
	missing: string[];
	/** True when the file already held exactly this content — nothing was written. */
	unchanged: boolean;
}

/**
 * Why `path` cannot be a download destination, or null when it can. The
 * destination is rewritten (overwrite mode) so it must never be the user's
 * main book, a demo file, or something outside OPFS's `.bean` files.
 */
export async function validateTargetFile(path: string): Promise<string | null> {
	const p = path.trim();
	if (p === '') return 'Choose a destination file.';
	if (p.startsWith('/') || p.includes('\\') || p.split('/').some((s) => s === '..' || s === '')) {
		return 'The destination must be a relative OPFS path.';
	}
	if (!p.endsWith('.bean')) return 'The destination must be a .bean file.';
	if (p === DEMO_DIR || p.startsWith(`${DEMO_DIR}/`)) {
		return 'Demo files are read-only reference data.';
	}
	if (p === (await appService.readBookFilename())) {
		return 'That is your main book — pick a separate prices file.';
	}
	return null;
}

/**
 * Paths named by `include "…"` directives in a book's text, resolved against
 * the directory of the including file (Beancount semantics) to OPFS-relative
 * paths. Pure; exported for tests.
 */
export function resolveIncludes(bookPath: string, text: string): string[] {
	const dir = bookPath.includes('/') ? bookPath.slice(0, bookPath.lastIndexOf('/')) : '';
	const paths: string[] = [];
	for (const m of text.matchAll(/^\s*include\s+"([^"]+)"/gm)) {
		const parts = (m[1].startsWith('/') ? m[1].slice(1) : `${dir}/${m[1]}`).split('/');
		const out: string[] = [];
		for (const part of parts) {
			if (part === '' || part === '.') continue;
			if (part === '..') out.pop();
			else out.push(part);
		}
		paths.push(out.join('/'));
	}
	return paths;
}

/**
 * Whether the main book includes `targetFile`, directly or through nested
 * includes (cycle-safe). `null` when it cannot be told (no book file set).
 * Glob patterns in include paths are not expanded, so `false` means "not
 * found", which the page words as a hint.
 */
export async function isTargetIncluded(targetFile: string): Promise<boolean | null> {
	const bookPath = await appService.readBookFilename();
	if (!bookPath) return null;
	const text = await readFile(bookPath);
	if (text === undefined) return null;

	const visited = new Set<string>([bookPath]);
	const queue = resolveIncludes(bookPath, text);
	while (queue.length > 0) {
		const path = queue.shift()!;
		if (path === targetFile) return true;
		if (visited.has(path)) continue;
		visited.add(path);
		let included: string | undefined;
		try {
			included = await readFile(path);
		} catch {
			continue; // missing/unreadable file — skip
		}
		if (included !== undefined) queue.push(...resolveIncludes(path, included));
	}
	return false;
}

function normalizeSelections(value: unknown): PriceSymbolSelections {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const selections: PriceSymbolSelections = {};
	for (const [providerId, symbols] of Object.entries(value as Record<string, unknown>)) {
		if (Array.isArray(symbols)) {
			selections[providerId] = symbols.filter((s): s is string => typeof s === 'string');
		}
	}
	return selections;
}

/** The stored symbol selection for a provider; `null` means all candidates. */
export async function getSymbolSelection(providerId: string): Promise<string[] | null> {
	const stored = await settings.get<unknown>(SettingKeys.priceSymbols);
	return normalizeSelections(stored)[providerId] ?? null;
}

export async function resolveConfig(): Promise<PriceDownloadConfig> {
	const [providerId, targetFile, writeMode, storedSelections] = await Promise.all([
		settings.get<string>(SettingKeys.priceProvider),
		settings.get<string>(SettingKeys.priceTargetFile),
		settings.get<PriceWriteMode>(SettingKeys.priceWriteMode),
		settings.get<unknown>(SettingKeys.priceSymbols)
	]);
	const id = providerId ?? defaultPriceProvider().id;
	return {
		providerId: id,
		targetFile: targetFile ?? PRICES_DEFAULT_DESTINATION,
		writeMode: writeMode === 'append' ? 'append' : 'overwrite',
		symbols: normalizeSelections(storedSelections)[id] ?? null
	};
}

// Symbol checkboxes save on every click; serialize the read-modify-write of
// the per-provider map so a fast second click cannot resurrect the first one's
// stale snapshot.
let configWrites: Promise<void> = Promise.resolve();

export function saveConfig(config: PriceDownloadConfig): Promise<void> {
	// A failed write must not poison the queue for later clicks.
	configWrites = configWrites
		.catch(() => {})
		.then(async () => {
			const stored = await settings.get<unknown>(SettingKeys.priceSymbols);
			const selections = normalizeSelections(stored);
			if (config.symbols === null) delete selections[config.providerId];
			else selections[config.providerId] = config.symbols;
			await Promise.all([
				settings.set(SettingKeys.priceProvider, config.providerId),
				settings.set(SettingKeys.priceTargetFile, config.targetFile),
				settings.set(SettingKeys.priceWriteMode, config.writeMode),
				settings.set(SettingKeys.priceSymbols, selections)
			]);
		});
	return configWrites;
}

/** Compute what a download run would do right now, without fetching anything. */
export async function planDownload(configArg?: PriceDownloadConfig): Promise<PriceDownloadPlan> {
	const config = configArg ?? (await resolveConfig());
	const provider = getPriceProvider(config.providerId);

	await fullLedgerService.ensureLoaded();
	const [declaredCommodities, bookPairs] = await Promise.all([
		fetchDeclaredCommodities(),
		fetchBookPricePairs()
	]);

	// Direction priority: the user's own series (outside the destination
	// file) first, then pairs this app itself wrote earlier — so a
	// hand-maintained series decides the direction, and previous downloads
	// just keep extending it.
	const destination = await readFile(config.targetFile);
	const destinationPairs: PricePair[] = [];
	if (destination !== undefined) {
		for (const directive of parsePriceFile(destination).directives.values()) {
			destinationPairs.push({ base: directive.base, quote: directive.quote });
		}
	}
	// The book's price table also contains the destination's own directives
	// (when it is included). Subtract them per pair, so what remains is the
	// user's own series and its real density.
	const destinationCounts = new Map<string, number>();
	for (const p of destinationPairs) {
		const key = `${p.base}/${p.quote}`;
		destinationCounts.set(key, (destinationCounts.get(key) ?? 0) + 1);
	}
	const userPairs = bookPairs.filter((p) => {
		const key = `${p.base}/${p.quote}`;
		const left = destinationCounts.get(key) ?? 0;
		if (left === 0) return true;
		destinationCounts.set(key, left - 1);
		return false;
	});

	const plan: SymbolPlan =
		provider.kind === 'securities'
			? deriveSecuritySymbols({
					declaredCommodities,
					covered: provider.resolveCovered
						? await provider.resolveCovered(declaredCommodities)
						: declaredCommodities
								.map((commodity) => commodity.name)
								.filter((symbol) => provider.covers(symbol))
				})
			: derivePriceSymbols({
					base: provider.base,
					declaredCommodities,
					userPairs,
					destinationPairs,
					covers: (symbol) => provider.covers(symbol)
				});

	// `null` (the default) keeps every candidate; an explicit list is an
	// allowlist, so an empty list means "download nothing".
	const selected = config.symbols == null ? null : new Set(config.symbols);
	const keep = (symbols: string[]) =>
		selected === null ? symbols : symbols.filter((s) => selected.has(s));

	return {
		provider,
		config,
		...plan,
		availableSymbols: plan.symbols,
		availableInvertedSymbols: plan.invertedSymbols,
		symbols: keep(plan.symbols),
		invertedSymbols: keep(plan.invertedSymbols)
	};
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
		const invalid = await validateTargetFile(config.targetFile);
		if (invalid) throw new Error(invalid);

		const plan = await planDownload(config);
		const toFetch = [...plan.symbols, ...plan.invertedSymbols];
		if (toFetch.length === 0) {
			// Nothing to fetch — not an error; the page explains why. Still record
			// the run so "last run" reflects it (previous fixing details stay).
			const previous = (await getDownloadStatus()) ?? emptyStatus(config);
			await deviceSettings.set(DeviceSettingKeys.priceDownloadStatus, {
				...previous,
				lastRun: new Date().toISOString(),
				lastError: null
			} satisfies PriceDownloadStatus);
			return planToResult(plan, '', 0, 0, 0);
		}

		const fetched = await provider.fetchLatest(toFetch);
		const incoming = toDirectives(fetched, plan.invertedSymbols, provider.base);

		const existing = await readFile(config.targetFile);
		let text: string;
		let added: number;
		let updated: number;
		let removed = 0;
		if (config.writeMode === 'overwrite') {
			text = buildPriceFile(
				incoming,
				provider.name,
				fetched.asOf,
				provider.kind === 'fx' ? 'latest fixing' : 'latest prices'
			);
			added = incoming.length;
			updated = 0;
		} else {
			// Pairs written this run supersede an older opposite-direction series
			// in the destination (the engine would coalesce both, denser wins).
			// Deriving the drop set from the incoming directives works for FX
			// native/inverted pairs and for securities (`commodity → AUD`).
			const dropPairs = new Set(incoming.map((d) => `${d.quote}/${d.base}`));
			const merged = mergePriceFile(existing ?? '', incoming, { dropPairs });
			text = merged.text;
			added = merged.added;
			updated = merged.updated;
			removed = merged.removed;
		}
		// Output is deterministic, so a re-run for the same fixing is detectable:
		// skip the write and the ledger reload.
		const unchanged = existing === text;
		if (unchanged) {
			added = 0;
			updated = 0;
		} else {
			await saveFile(config.targetFile, text);
		}
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
			removed,
			directives,
			symbols: plan.symbols,
			invertedSymbols: plan.invertedSymbols,
			skippedUnsupported: plan.skippedUnsupported,
			securities: plan.securities,
			missing: fetched.missing,
			unchanged
		};

		const { unchanged: _unchanged, ...statusFields } = result;
		await deviceSettings.set(DeviceSettingKeys.priceDownloadStatus, {
			lastRun: new Date().toISOString(),
			...statusFields,
			lastError: null
		} satisfies PriceDownloadStatus);

		// Standard file-mutation pattern: reload in the background so queries,
		// reports and the staleness indicator pick up the new prices. The page
		// follows `fullLedgerService.version` to refresh its preview afterwards.
		if (!unchanged) void reloadLedgerFromOpfs();

		return result;
	} catch (err) {
		// Record the failure for the status card, then re-throw to the caller.
		// The previous successful run's details stay: a transient offline error
		// must not erase "last fixing date" and "last destination".
		const message = describeError(err);
		const previous = await getDownloadStatus();
		const status: PriceDownloadStatus = {
			...(previous ?? emptyStatus(config)),
			lastRun: new Date().toISOString(),
			lastError: message
		};
		await deviceSettings.set(DeviceSettingKeys.priceDownloadStatus, status);
		throw new Error(message, { cause: err });
	}
}

function emptyStatus(config: PriceDownloadConfig): PriceDownloadStatus {
	return {
		lastRun: '',
		fixingDate: '',
		added: 0,
		updated: 0,
		removed: 0,
		symbols: [],
		invertedSymbols: [],
		skippedUnsupported: [],
		securities: [],
		missing: [],
		targetFile: config.targetFile,
		writeMode: config.writeMode,
		lastError: null
	};
}

/** A user-facing message: a failed `fetch` surfaces as a bare `TypeError`. */
export function describeError(err: unknown): string {
	if (err instanceof TypeError) {
		return 'Could not reach the rate provider — check your connection and try again.';
	}
	return err instanceof Error ? err.message : String(err);
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
		removed: 0,
		directives,
		symbols: plan.symbols,
		invertedSymbols: plan.invertedSymbols,
		skippedUnsupported: plan.skippedUnsupported,
		securities: plan.securities,
		missing: [],
		unchanged: false
	};
}
