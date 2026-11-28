/**
 * The shared settings the app keeps a copy of in memory, for showing amounts and dates. Load them
 * again whenever the settings table is written as a whole (startup, restore, sync).
 */
import { DATE_FORMAT_DEFAULT, SHORT_DATE_FORMAT_DEFAULT } from '#lib/constants';
import { DateFormatStore, DefaultCurrencyStore, ShortDateFormatStore } from '#lib/data/mainStore';
import { SettingKeys, settings } from '#lib/settings';

export async function loadDisplaySettings(): Promise<void> {
	const shortDateFormat = await settings.get<string>(SettingKeys.shortDateFormat);
	ShortDateFormatStore.set(shortDateFormat ?? SHORT_DATE_FORMAT_DEFAULT);

	const dateFormat = await settings.get<string>(SettingKeys.dateFormat);
	DateFormatStore.set(dateFormat ?? DATE_FORMAT_DEFAULT);

	// Empty makes `getDefaultCurrency()` look again.
	DefaultCurrencyStore.set((await settings.get<string>(SettingKeys.currency)) ?? '');
}
