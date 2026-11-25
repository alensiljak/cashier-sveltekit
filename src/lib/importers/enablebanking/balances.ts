import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import type { EbBalance } from './api';

/**
 * The last fetched balances per account (key: `accountKey`), kept on the
 * device so that opening the page does not call the bank again.
 */
export interface CachedBalances {
	balances: EbBalance[];
	/** ISO timestamp of the fetch. */
	fetchedAt: string;
}

export type BalanceCache = Record<string, CachedBalances>;

export async function loadBalanceCache(): Promise<BalanceCache> {
	return (await deviceSettings.get<BalanceCache>(DeviceSettingKeys.enableBankingBalances)) ?? {};
}

export async function saveBalanceCache(cache: BalanceCache): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.enableBankingBalances, cache);
}

/** Drop the cached balances of one session. */
export async function removeSessionBalances(sessionId: string): Promise<void> {
	const cache = await loadBalanceCache();
	const kept = Object.entries(cache).filter(([key]) => !key.startsWith(`${sessionId}:`));
	await saveBalanceCache(Object.fromEntries(kept));
}

export async function clearBalanceCache(): Promise<void> {
	await deviceSettings.delete(DeviceSettingKeys.enableBankingBalances);
}
