/**
 * Parses Beancount output
 */

import { Account } from "$lib/data/model"

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

function parseCurrentValues(
    lines: Array<string>,
    rootAccount: string,
): Record<string, string> {
    const result: Record<string, string> = {}

    debugger
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
export { parseBalanceSheetRow, parseCurrentValues }
