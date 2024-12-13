import { loadInvestmentAccounts } from "$lib/services/accountsService";
import { SettingKeys, settings } from "$lib/settings";

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
    // todo: load asset classes.

    const currency = await settings.get(SettingKeys.currency)

    return {serverUrl, investmentAccounts, currency}
}