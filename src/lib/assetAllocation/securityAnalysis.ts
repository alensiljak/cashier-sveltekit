import moment from 'moment'
import { settings, SettingKeys } from '../settings'
import { SyncApiClient } from './syncApiClient'
import appService from '$lib/services/appService'
import { getQueries } from '$lib/sync-queries'
import * as BeancountParser from '$lib/utils/beancountParser'
import * as LedgerParser from '$lib/utils/ledgerParser'

const DATE_FORMAT = 'YYYY-MM-DD'

/**
 * Security Analysis for symbols.
 * Calculates yield, etc.
 */

export interface SecurityAnalysis {
  yield: string
  gainloss: string
}

export class SecurityAnalyser {
  currency: string | undefined
  syncApiClient: SyncApiClient

  constructor() {
    // symbol, currency
    // this.symbol = symbol
    //this.currency = null
    this.syncApiClient = new SyncApiClient()
  }

  /**
   * Performs the Security Analysis with Ledger data.
   * @param {string} symbol
   */
  // async getSecurityAnalysisFor(symbol: string): Promise<SecurityAnalysis> {
  //   let currency = await settings.get(SettingKeys.currency)
  //   this.currency = currency
  //   await this.syncApiClient.init()

  //   let result: SecurityAnalysis = {
  //     yield: await this.getYield(symbol, currency),
  //     gainloss: await this.getGainLoss(symbol, currency),
  //     //basis: await this.#getBasis(symbol, currency),
  //   }

  //   return result
  // }

  /**
   * Used temporarily only to check the base amount. It mostly fits the gain/loss plus
   * the balance in base currency (not always!).
   * @param symbol
   * @param currency
   * @returns
   */
  // eslint-disable-next-line no-unused-private-class-members
  async #getBasis(symbol: string, currency: string) {
    const ptaSystem = await settings.get(SettingKeys.ptaSystem) as string
    const queries = getQueries(ptaSystem)
    const command = queries.basis(symbol, currency)

    const report = await this.syncApiClient.query(command)

    return report
  }

  /**
   * Calculate the yield in the last 12 months.
   * This value is affected by the recent purchases, which result in seemingly lower yield!
   */
  async getYield(symbol: string): Promise<string> {
    const currency = await settings.get(SettingKeys.currency) as string
    this.currency = currency
    await this.syncApiClient.init()

    // Retrieve income amount.
    const incomeStr = await this.#getIncomeBalance(symbol)
    let income = Number(incomeStr)
    // turn into a positive number
    income = income * -1

    // Retrieve the current value of the holding.
    const valueStr = await this.#getValueBalance(symbol, currency)
    const value = Number(valueStr)

    // Calculate
    let _yield = null
    if (value == 0.0) {
      _yield = 0.0
    } else {
      _yield = (income * 100) / value
    }

    const result = _yield.toFixed(2) + '%'

    return result
  }

  async getGainLoss(symbol: string) {
    const currency = await appService.getDefaultCurrency()
    this.currency = currency
    await this.syncApiClient.init()

    const ptaSystem = await settings.get(SettingKeys.ptaSystem) as string
    const queries = getQueries(ptaSystem)
    const command = queries.gainLoss(symbol, currency)

    const report: Array<any> = await this.syncApiClient.query(command) as Array<any>
    if (report.length == 0) {
      return 'n/a'
    }
    if (report.length > 1) {
      throw new Error('Multiple gainloss records found for symbol ' + symbol)
    }
    // With Beancount, the result is an array of all accounts with this column values.
    const line: Array<string> = report[0]
    // Line contains columns: [(594.52 USD), (594.52 USD)]
    const costBasis = BeancountParser.getNumberFromTupleString(line[0])
    const marketValue = BeancountParser.getNumberFromTupleString(line[1])
    const gainLoss = marketValue - costBasis

    // const number = this.#getNumberFromCollapseResult(line)
    const result = gainLoss.toFixed(2) + ' ' + this.currency

    // calculate the percentage

    return result
  }

  /**
   * Get the income in the last year.
   * @returns {Promise<number>} The amount from the symbol's income balance
   */
  async #getIncomeBalance(symbol: string): Promise<number> {
    const currency = this.currency as string
    const yieldFrom = moment().subtract(1, 'year').format(DATE_FORMAT)

    const ptaSystem = await settings.get(SettingKeys.ptaSystem) as string
    const queries = getQueries(ptaSystem)
    const command = queries.incomeBalance(symbol, yieldFrom, currency)

    const report = await this.syncApiClient.query(command)
    if (report['error']) {
      throw new Error(report['error'])
    }

    let total;
    if (ptaSystem == 'ledger') {
      total = LedgerParser.getNumberFromBalanceRow(report)
    } else if (ptaSystem == 'beancount') {
      total = BeancountParser.getNumberFromBalanceRow(report)
    } else {
      throw new Error('Unknown PTA system: ' + ptaSystem)
    }

    return total
  }

  async #getValueBalance(symbol: string, currency: string) {
    const ptaSystem = await settings.get(SettingKeys.ptaSystem) as string
    const queries = getQueries(ptaSystem)
    const command = queries.valueBalance(symbol, currency)

    const api = this.syncApiClient

    await api.init()
    const report = await api.query(command)

    if (ptaSystem == 'ledger') {
      return LedgerParser.getNumberFromBalanceRow(report)
    } else if (ptaSystem == 'beancount') {
      return BeancountParser.getNumberFromBalanceRow(report)
    } else {
      throw new Error('Unknown PTA system: ' + ptaSystem)
    }
  }

  /**
   * Parses a 1-line ledger result, when --collapse is used
   * @param {String} line
   */
  #getNumberFromCollapseResult(line: string): string {
    if (!line) {
      return 'n/a'
    }
    line = line.trim()

    // -1,139 EUR  Assets
    const parts = line.split(' ')
    if (parts.length != 4) {
      throw new Error('wrong number of parts!')
    }

    let totalNumeric = parts[0]
    totalNumeric = totalNumeric.replaceAll(',', '')
    return totalNumeric
  }
}
