import { AssetAllocationStore } from "$lib/data/mainStore";
import { loadInvestmentAccounts } from "$lib/services/accountsService";
import { SettingKeys, settings } from "$lib/settings";
import { get } from "svelte/store";

/*
    Asset Class Detail
 */
export async function load() {
    const serverUrl = await settings.get(SettingKeys.syncServerUrl)
    if(!serverUrl) {
        throw new Error('Sync Server URL not set!')
    }

    // const acctSvc = new AccountService()
    const investmentAccounts = await loadInvestmentAccounts()
    if(investmentAccounts.length === 0) {
        console.warn('No investment accounts found')
    }

    // todo: add the balances.
    // load asset classes.
    const aa = get(AssetAllocationStore)

    const currency = await settings.get(SettingKeys.currency)

    return { serverUrl, investmentAccounts, currency, aa }
}