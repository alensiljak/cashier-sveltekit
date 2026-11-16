/**
 * Registry of price download providers. New providers (securities quotes,
 * a self-hosted proxy over the raw ECB XML, …) implement PriceProvider and
 * register here; the download page's dropdown and all of its logic are
 * provider-agnostic.
 */

import type { PriceProvider } from './priceProvider';
import { ecbPriceProvider } from './ecbPriceProvider';
import { vanguardAuPriceProvider } from './vanguardAuPriceProvider';

const providers: PriceProvider[] = [ecbPriceProvider, vanguardAuPriceProvider];

export function listPriceProviders(): PriceProvider[] {
	return providers;
}

export function getPriceProvider(id: string): PriceProvider {
	const found = providers.find((p) => p.id === id);
	if (!found) throw new Error(`Unknown price provider: ${id}`);
	return found;
}

export function defaultPriceProvider(): PriceProvider {
	return providers[0];
}
