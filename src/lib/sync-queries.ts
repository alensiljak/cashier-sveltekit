/**
 * Contains queries for the sync, PTA system.
 */

export interface Queries {
    accounts(): string
    balances(): string
    currentValues(rootAccount: string, currency: string): string
    lots(symbol: string): string
    payees(from: string): string
}


const LedgerQueries: Queries = {
    accounts: () =>
        'b --flat --empty --no-total',
    balances: () =>
        'b --flat --no-total',
    currentValues: (rootAccount: string, currency: string) =>
        `b ^${rootAccount} -X ${currency} --flat --no-total`,
    lots: (symbol: string) =>
        `b ^Assets and invest and :${symbol}$ --lots --no-total --collapse`,
    payees: (from: string) =>
        `payees -b ${from}`,
}

const BeancountQueries: Queries = {
    /**
     * # is url-encoded (%23)
     * @returns accounts query
     */
    accounts: () => 
        'SELECT sum(number), currency, account ORDER BY account',
        //'SELECT account FROM %23accounts WHERE close IS NULL',
    balances: () => 
        'SELECT account, sum(position) ORDER BY account',
    currentValues: (rootAccount: string, currency: string) =>
        `select account, CONVERT(sum(position), '${currency}')
        where account = '${rootAccount}'`,
        //group by account`,
    lots: (symbol: string) =>
        'balances',
    payees: (from: string) =>
        `SELECT COALESCE(payee, narration) as payee FROM transactions
            WHERE date >= '${from}' ORDER BY payee`,
}

export function getQueries(ptaSystem: string): Queries {
    if (ptaSystem === 'ledger') {
        return LedgerQueries
    } else if (ptaSystem == 'beancount') {
        return BeancountQueries
    } else {
        throw new Error('Unknown PTA system: ' + ptaSystem)
    }
}
