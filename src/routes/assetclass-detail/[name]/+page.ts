import { AssetAllocationStore } from "$lib/data/mainStore";
import * as AccountService from "$lib/services/accountsService";
import appService from "$lib/services/appService";
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
    const investmentAccounts = await AccountService.loadInvestmentAccounts()
    if(investmentAccounts.length === 0) {
        console.warn('No investment accounts found')
    }

    // add the balances.
    await AccountService.populateAccountBalances(investmentAccounts)

    // load asset classes.
    const aa = get(AssetAllocationStore)

    const currency = await appService.getDefaultCurrency()

    return { serverUrl, investmentAccounts, currency, aa }
}