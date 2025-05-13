/*
  Synchronization with Cashier (Ledger/Beancount) server.
*/
import { settings, SettingKeys } from '$lib/settings'
import moment from 'moment'
import { AssetAllocationEngine } from './assetAllocation/AssetAllocation'
import appService from './services/appService'
import { ISODATEFORMAT } from './constants'
import { getQueries } from './sync-queries'
import type { Queries } from './sync-queries'

/**
 * Cashier Sync class communicates with the CashierSync server over network.
 * The methods here represent the methods implemented by the server. 
 * This is a proxy class for fething Ledger data.
 */
export class CashierSync {
  /**
   * This returns all the accounts and also includes the balances
   */
  serverUrl: string
  queries: Queries

  constructor(serverUrl: string, ptaSystem: string) {
    if (!serverUrl) {
      throw new Error('CashierSync URL not set.')
    }
    if (serverUrl.endsWith('/')) {
      serverUrl = serverUrl.substring(0, serverUrl.length - 1)
    }
    this.serverUrl = serverUrl
    this.queries = getQueries(ptaSystem)
  }

  async get(path: string, options?: object) {
    const url = new URL(`${this.serverUrl}${path}`)
    const response = await fetch(url, options)
    return response
  }

  createUrl(query: string): URL {
    const path = this.createPath(query)
    const url = new URL(`${this.serverUrl}${path}`)
    return url
  }

  createPath(query: string) {
    return `?query=${query}`
  }

  /**
   * Sends a ledger query to the Ledger server and returns the response.
   * @param {String} query
   */
  async send(query: string, options?: object) {
    const url = this.createUrl(query)

    const response = await fetch(url, options)
    return response
  }

  /**
   * See if the server is running
   */
  async healthCheck(): Promise<string> {
    // HEAD is enough to check if the server is online.
    const result = await this.get('/ping')
    if (!result.ok) {
      throw new Error('Error contacting Cashier server!')
    }

    const text = await result.text()
    return text
  }

  /**
   * Retrieve the list of accounts
   * @returns array of Account objects
   */
  async readAccounts(): Promise<string[]> {
    const accountsQuery = this.queries.accounts()
    const response = await this.send(accountsQuery)
    if (!response.ok) {
      throw new Error('Error reading accounts!')
    }

    const content = (await response.json()) as string[]

    return content
  }

  /**
   * Retrieve the account balances.
   * @returns array of Account objects
   */
  async readBalances(): Promise<string[]> {
    //const currency = await appService.getDefaultCurrency()
    // Get values in the default currency? In case of multi-currency accounts (i.e. expenses).

    const balancesQuery = this.queries.balances()
    const response = await this.send(balancesQuery)
    const content: string[] = await response.json()

    return content
  }

  /**
   * Get current account values in the base currency.
   * @returns Current account values
   */
  async readCurrentValues(): Promise<string> {
    const rootAccount = await settings.get(SettingKeys.rootInvestmentAccount) as string
    if (!rootAccount) {
      throw new Error('No root investment account set!')
    }
    const currency = await appService.getDefaultCurrency()
    if (!currency) {
      throw new Error('No default currency set!')
    }

    const query = this.queries.currentValues(rootAccount, currency)

    const response = await this.send(query)
    const result: Array<string> = await response.json()

    // parse
    const currentValues = this.parseCurrentValues(result, rootAccount)

    const aa = new AssetAllocationEngine()
    await aa.importCurrentValuesJson(currentValues)
    return 'OK'
  }

  parseCurrentValues(
    lines: Array<string>,
    rootAccount: string,
  ): Record<string, string> {
    const result: Record<string, string> = {}

    for (const line of lines) {
      if (line === '') continue

      const row = line.trim()

      // split at the root account name
      const rootIndex = row.indexOf(rootAccount)

      let amount = row.substring(0, rootIndex)
      amount = amount.trim()

      const account = row.substring(rootIndex)

      // add to the dictionary
      result[account] = amount
    }

    return result
  }

  async readLots(symbol: string) {
    const query = this.queries.lots(symbol)

    const response = await this.send(query)
    if (!response.ok) throw new Error('error fetching lots: ' + response.text())

    const result: string[] = await response.json()

    // remove "Assets" account title
    const lastIndex = result.length - 1
    const lastLine = result[lastIndex]
    if (lastLine.includes('Assets')) {
      const parts = lastLine.split('Assets')
      const value = parts[0]
      result[lastIndex] = value
    }

    return result
  }

  /**
   * Retrieve the list of Payees
   * @returns array of Payee objects
   */
  async readPayees(): Promise<string[]> {
    // Limit the payees to the last 5 years, otherwise there's a high risk of crashing.
    // This command is somehow very memory hungry on Android.
    const from = moment().subtract(5, 'years').format(ISODATEFORMAT)
    const query = this.queries.payees(from)
    const response = await this.send(query, { timeout: 20000 })
    if (!response.ok) {
      throw new Error('Error reading payees!')
    }

    const content = (await response.json()) as string[]

    return content
  }

  /**
   * This no longer exists.
   * @param searchParams 
   * @returns 
   */
  async search(searchParams: object) {
    const url = new URL(`${this.serverUrl}/search`)

    // For GET, use URL Search Params, for POST, use Form Data:
    //const params = new URLSearchParams() // use params.set()
    //Object.keys(searchParams).forEach(key => params.set(key, searchParams[key]))
    //const params = new FormData(); // use params.append()
    //Object.keys(searchParams).forEach(key => params.append(key, searchParams[key]))

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchParams)
    })
    const result = await response.json()
    return result
  }

  async xact(parameters: object) {
    const url = new URL(`${this.serverUrl}/xact`)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters)
    })
    //const result = await response.json()
    const result = await response.text()
    return result
  }

  /**
   * Shutdown Cashier Server from the client app.
   */
  shutdown() {
    return this.get('/shutdown')
  }
}
