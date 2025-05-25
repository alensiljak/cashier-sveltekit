/**
 * Parses Ledger output
 */

import { Account } from "$lib/data/model"

function parseBalanceSheetRow(line: string): Account | null {
    let account = new Account('')
    let accountBalances: Record<string, number> = {}

    // name
    const namePart = line.substring(21).trim()
    account.name = namePart

    let balancePart = line.substring(0, 20)
    balancePart = balancePart.trim()
    // separate the currency
    const balanceParts = balancePart.split(' ')

    // currency
    let currencyPart = balanceParts[1]
    if (typeof currencyPart === 'undefined') {
        currencyPart = ''
    }

    let amountPart = balanceParts[0]
    // clean-up the thousand-separators
    amountPart = amountPart.replace(/,/g, '')

    accountBalances[currencyPart] = parseFloat(amountPart)

    // If we do not have a name, it's an amount of a multicurrency account.
    // Keep the balance until we get the line with the account name.
    if (!namePart) return null

    // Once we have the name, assign the balances dictionary and keep for update.
    account.balances = accountBalances

    return account
}

function parseCurrentValues(
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

export { parseBalanceSheetRow, parseCurrentValues }
