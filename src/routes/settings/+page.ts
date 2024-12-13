import appService from "$lib/services/appService";
import { SettingKeys, settings } from "$lib/settings.js";

export async function load() {
    const data = await loadSettings()
    return data
}

async function loadSettings() {
    const currency = await appService.getDefaultCurrency()
    const rootInvestmentAccount = await settings.get(SettingKeys.rootInvestmentAccount);
    const rememberLastTransaction = await settings.get(SettingKeys.rememberLastTransaction);

    return { currency, rootInvestmentAccount, rememberLastTransaction }
}
