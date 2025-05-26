/**
 * Parses Beancount output
 */

import { Account, Money } from "$lib/data/model"

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

interface CurrentValueRow {
    account: string
    balance: Money
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
): CurrentValueRow {
    // The return value { "account": amount }
    const result: CurrentValueRow = {
        account: '',
        balance: new Money(),
    }

    try {
        for (const row of lines) {
            result.account = row[0]

            let balances: Array<Any> = row[1]
            // balances is an array of balance records.
            // Trim null elements (leftover from a tuple)
            balances = balances.filter(element => element !== null);
            // At this point we should have only one balance in the
            // common currency.
            const balance = balances[0]
            let amount = 0
            let currency = 'n/a'
            if (balance && balance.length != 0) {
                // Amount is an array of number and currency.
                const amountArray: Array<Any> = balance[0]
                amount = amountArray[0]
                currency = amountArray[1]
            }

            // add to the dictionary
            result.balance.quantity = amount
            result.balance.currency = currency
        }
    } catch (error) {
        console.error(error)
    }

    return result
}
export { parseBalanceSheetRow, parseCurrentValues }
export type { CurrentValueRow }
