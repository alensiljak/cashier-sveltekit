/**
 * Parses Beancount output
 */

import { Account, Money } from "$lib/data/model"
import type { AccountWithBalance, CurrentValuesDict } from "$lib/data/viewModels"

/**
 * Creates an Account object from a Beancount balance sheet record.
 * @param record The record to parse
 * @returns populated Account object
 */
function parseBalanceSheetRow(record: string[]): Account | null {
    let account = new Account('')
    let accountBalances: Record<string, number> = {}

    // currency
    const currency = record[1]
    // account.cu

    // amount
    const amount = record[0]
    // account.
    accountBalances[currency] = parseFloat(amount)

    // name
    const name = record[2]
    account.name = name

    // Once we have the name, assign the balances dictionary and keep for update.
    account.balances = accountBalances

    return account
}

/**
 * Parses a standard balance row
 * [
 *    "(-127.68 EUR)", 
 *    "Income:Investment:Dividend:MMLP-MI"
 * ]
 */
function getNumberFromBalanceRow(row: Array<string>): number {
    if (row.length === 0) return 0
    const record = row[0]

    let amount_str = record[0]
    amount_str = amount_str.replace('(', '')
    amount_str = amount_str.replace(')', '')

    let amount: Money = Money.fromString(amount_str)

    return amount.quantity
}

/**
 * 
 * @param lines Array of records. Result returned from Cashier Server.
 * @param rootAccount 
 * @returns 
 */
function parseCurrentValues(
    lines: Array<Any>,
    rootAccount: string,
): CurrentValuesDict {
    // The return value { "account": amount }
    const result: CurrentValuesDict = {}

    try {
        for (const row of lines) {
            const account = row[0]

            let balances: Array<Any> = row[1]
            // balances is an array of balance records.
            // Trim null elements (leftover from a tuple)
            balances = balances.filter(element => element !== null);
            // At this point we should have only one balance in the
            // common currency.
            const balance = balances[0]
            let amount = 0
            let currency = null
            if (balance && balance.length != 0) {
                // Amount is an array of number and currency.
                const amountArray: Array<Any> = balance[0]
                amount = amountArray[0]
                currency = amountArray[1]
            }

            // add to the dictionary
            result[account] = { quantity: amount, currency: currency }
        }
    } catch (error) {
        console.error(error)
    }

    return result
}

export { parseBalanceSheetRow, parseCurrentValues, getNumberFromBalanceRow }
