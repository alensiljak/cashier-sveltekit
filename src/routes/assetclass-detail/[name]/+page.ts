import { goto } from "$app/navigation";
import type { AssetClass, StockSymbol } from "$lib/AssetClass";
import { AssetAllocationStore } from "$lib/data/mainStore";
import type { Account } from "$lib/data/model.js";
import * as AccountService from "$lib/services/accountsService";
import appService from "$lib/services/appService";
import { SettingKeys, settings } from "$lib/settings";
import { get } from "svelte/store";

/*
    Asset Class Detail
 */
export async function load({ params }) {
    // load asset classes.
    const aa = get(AssetAllocationStore)
    if (!aa) {
        await goto('/asset-allocation')
        return
    }

    const serverUrl = await settings.get(SettingKeys.syncServerUrl)
    if (!serverUrl) {
        throw new Error('Sync Server URL not set!')
    }

    // const acctSvc = new AccountService()
    const investmentAccounts = await AccountService.loadInvestmentAccounts()
    if (investmentAccounts.length === 0) {
        console.warn('No investment accounts found')
    }

    // add the balances.
    await AccountService.populateAccountBalances(investmentAccounts)

    const currency = await appService.getDefaultCurrency()

    // load asset class
    console.debug(aa)
    console.debug(params.name)
    const assetClass = aa?.find(ac => ac.fullname === params.name)
    if (!assetClass) {
        throw new Error('Asset class not found')
    }
    const stocks = populateStocksWithCaching(assetClass, investmentAccounts)

    // todo: securityAnalysis

    return { serverUrl, investmentAccounts, currency, aa, assetClass, stocks }
}

function populateStocksWithCaching(assetClass: AssetClass, investmentAccounts: Account[]) {
    const stocks = populateStocks(assetClass, investmentAccounts)

    // todo: cache them into store
    
    return stocks
}

function populateStocks(assetClass: AssetClass, investmentAccounts: Account[]): StockSymbol[] {
    const result: StockSymbol[] = []

    const children = assetClass.symbols
    if (!children) return result
    if (children.length === 0) return result

    children.forEach(childName => {
        const stock: StockSymbol = {
            name: childName,
            accounts: [],
            analysis: undefined
        }

        // find all accounts with this commodity
        const stockAccounts = investmentAccounts.filter(acct => acct.balance?.currency === childName)
        stock.accounts.push(...stockAccounts)

        result.push(stock)
    })

    return result
}