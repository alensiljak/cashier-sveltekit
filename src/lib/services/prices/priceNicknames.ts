/**
 * Persistence for the book-driven price download's nickname map and ignore
 * list (doc/projects/2026-11-16_book-driven-price-download.md).
 *
 * A nickname is the `source` part of a commodity's Beancount `price` meta
 * (`QUOTE:source/SYMBOL`); it maps to a registered provider id.
 */

import { settings, SettingKeys } from '#lib/settings';
import fullLedgerService from '#lib/services/ledgerWorkerClient';
import { parsePriceMeta } from './bookPricePlan';

export type PriceNicknames = Record<string, string>;

/** Shipped mapping, used until the user saves their own. */
export const DEFAULT_NICKNAMES: PriceNicknames = { ecbrates: 'ecb-frankfurter' };

function normalizeNicknames(stored: unknown): PriceNicknames | null {
	if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return null;
	const out: PriceNicknames = {};
	for (const [nick, id] of Object.entries(stored)) {
		if (typeof id === 'string' && id !== '') out[nick] = id;
	}
	return out;
}

export async function getNicknames(): Promise<PriceNicknames> {
	const stored = normalizeNicknames(await settings.get<unknown>(SettingKeys.priceNicknames));
	return stored ?? { ...DEFAULT_NICKNAMES };
}

export async function saveNicknames(nicknames: PriceNicknames): Promise<void> {
	await settings.set(SettingKeys.priceNicknames, nicknames);
}

export async function getIgnored(): Promise<string[]> {
	const stored = await settings.get<unknown>(SettingKeys.priceIgnored);
	return Array.isArray(stored) ? stored.filter((s): s is string => typeof s === 'string') : [];
}

export async function saveIgnored(ignored: string[]): Promise<void> {
	await settings.set(SettingKeys.priceIgnored, ignored);
}

/** Provider ids the user switched off. Everything else is enabled. */
export async function getDisabledProviders(): Promise<string[]> {
	const stored = await settings.get<unknown>(SettingKeys.priceDisabledProviders);
	return Array.isArray(stored) ? stored.filter((s): s is string => typeof s === 'string') : [];
}

export async function setProviderEnabled(providerId: string, enabled: boolean): Promise<void> {
	const disabled = new Set(await getDisabledProviders());
	if (enabled) disabled.delete(providerId);
	else disabled.add(providerId);
	await settings.set(SettingKeys.priceDisabledProviders, [...disabled].sort());
}

export interface BookSource {
	source: string;
	/** Commodities whose (first) `price` entry uses this source. */
	commodities: string[];
}

/** Distinct `price` sources used by the book's commodity directives. */
export async function fetchBookSources(): Promise<BookSource[]> {
	const directives = await fullLedgerService.getCommodityDirectives();
	const bySource = new Map<string, string[]>();
	for (const { currency, meta } of directives) {
		const spec = parsePriceMeta(meta?.price).specs[0];
		if (!spec) continue;
		const list = bySource.get(spec.source) ?? [];
		list.push(currency);
		bySource.set(spec.source, list);
	}
	return [...bySource]
		.map(([source, commodities]) => ({ source, commodities }))
		.sort((a, b) => a.source.localeCompare(b.source));
}
