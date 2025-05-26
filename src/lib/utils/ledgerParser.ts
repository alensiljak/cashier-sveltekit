/**
 * Parses Ledger output
 */

import { LedgerOutputParser } from "$lib/assetAllocation/ledgerOutputParser"
import { Account, Money } from "$lib/data/model"
import type { CurrentValuesDict } from "./beancountParser"

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
): CurrentValuesDict {
    const result: CurrentValuesDict = {}

    for (const line of lines) {
        if (line === '') continue

        const row = line.trim()

        // split at the root account name
        const rootIndex = row.indexOf(rootAccount)

        let balance = row.substring(0, rootIndex)
        balance = balance.trim()

        const account = row.substring(rootIndex)

        // split the balance into amount/currency.
        const moneyParts = balance.split(' ')

        // todo: test!

        result[account].quantity = parseFloat(moneyParts[0])
        result[account].currency = moneyParts[1]
    }

    return result
}

/**
 * Extracts the numeric amount value from the ledger Total response.
 * @param {Array} ledgerReport
 */
function getNumberFromBalanceRow(ledgerReport: Array<string>): number {
    if (ledgerReport.length == 0) {
      return 0
    }

    //let line = ledgerReport[0]
    const parser = new LedgerOutputParser()
    const totalLines = parser.getTotalLines(ledgerReport)
    if (totalLines.length == 0) {
      throw new Error('No total received!')
    }
    let totalLine = totalLines[0]

    // Gets the numeric value of the total from the ledger total line
    totalLine = totalLine.trim()
    const parts = totalLine.split(' ')
    let totalNumeric = parts[0]
    // remove thousand-separators
    totalNumeric = totalNumeric.replaceAll(',', '')

    return totalNumeric
}

export { parseBalanceSheetRow, parseCurrentValues, getNumberFromBalanceRow }
