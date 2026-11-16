/**
 * Provider catalogues for securities price providers.
 *
 * The catalogue (e.g. every Vanguard AU fund) is large and rarely changes, so
 * it is downloaded only when the user presses a button, cached on this device,
 * and the user picks the products they care about. The picked products are
 * stored in shared settings as self-contained records, so planning and routine
 * downloads never touch the catalogue or the network for it.
 */

import { settings, deviceSettings, SettingKeys, DeviceSettingKeys } from '#lib/settings';
import type { CatalogueProduct } from './priceProvider';
import { getPriceProvider } from './priceProviderRegistry';

export interface StoredCatalogue {
	/** ISO timestamp of the download. */
	fetchedAt: string;
	products: CatalogueProduct[];
}

function isProduct(value: unknown): value is CatalogueProduct {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return typeof v.portId === 'string' && typeof v.label === 'string';
}

function normalizeProducts(value: unknown): CatalogueProduct[] {
	return Array.isArray(value) ? value.filter(isProduct) : [];
}

function recordOf(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Whether the provider has a catalogue the user can download and pick from. */
export function hasCatalogue(providerId: string): boolean {
	return typeof getPriceProvider(providerId).fetchCatalogue === 'function';
}

/** The cached catalogue for a provider, or null when never downloaded. */
export async function getCatalogue(providerId: string): Promise<StoredCatalogue | null> {
	const stored = recordOf(await deviceSettings.get<unknown>(DeviceSettingKeys.priceCatalogues));
	const entry = recordOf(stored[providerId]);
	if (typeof entry.fetchedAt !== 'string') return null;
	return { fetchedAt: entry.fetchedAt, products: normalizeProducts(entry.products) };
}

/** Download the provider's catalogue (network) and cache it. User-triggered only. */
export async function refreshCatalogue(providerId: string): Promise<StoredCatalogue> {
	const provider = getPriceProvider(providerId);
	if (!provider.fetchCatalogue) throw new Error(`${provider.name} has no catalogue.`);
	const products = await provider.fetchCatalogue();
	const catalogue: StoredCatalogue = { fetchedAt: new Date().toISOString(), products };
	const stored = recordOf(await deviceSettings.get<unknown>(DeviceSettingKeys.priceCatalogues));
	await deviceSettings.set(DeviceSettingKeys.priceCatalogues, {
		...stored,
		[providerId]: catalogue
	});
	return catalogue;
}

/** The products the user chose for a provider (empty when none). */
export async function getCatalogueSelection(providerId: string): Promise<CatalogueProduct[]> {
	const stored = recordOf(await settings.get<unknown>(SettingKeys.priceCatalogueSelection));
	return normalizeProducts(stored[providerId]);
}

// Checkbox clicks save immediately; serialize the read-modify-write so a fast
// second click cannot resurrect the first one's stale snapshot.
let selectionWrites: Promise<void> = Promise.resolve();

export function saveCatalogueSelection(
	providerId: string,
	products: CatalogueProduct[]
): Promise<void> {
	selectionWrites = selectionWrites
		.catch(() => {})
		.then(async () => {
			const stored = recordOf(await settings.get<unknown>(SettingKeys.priceCatalogueSelection));
			await settings.set(SettingKeys.priceCatalogueSelection, {
				...stored,
				[providerId]: products
			});
		});
	return selectionWrites;
}
