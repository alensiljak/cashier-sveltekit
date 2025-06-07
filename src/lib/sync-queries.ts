/**
 * Contains queries for the sync, PTA system.
 */

export interface Queries {
    accounts(): string
    openAccounts(): string
    balances(): string
    currentValues(rootAccount: string, currency: string): string
    lots(symbol: string): string
    payees(from: string): string
    incomeBalance(symbol: string, yieldFrom: string, currency: string): string
    gainLoss(symbol: string, currency: string): string
    valueBalance(symbol: string, currency: string): string
    basis(symbol: string, currency: string): string
}


const LedgerQueries: Queries = {
    accounts: () =>
        'b --flat --empty --no-total',
    /**
     * This functionality does not exist with Ledger.
     */
    openAccounts: () =>
        'b --flat --no-total',
    balances: () =>
        'b --flat --no-total',
    currentValues: (rootAccount: string, currency: string) =>
        `b ^${rootAccount} -X ${currency} --flat --no-total`,
    lots: (symbol: string) =>
        `b ^Assets and invest and :${symbol}$ --lots --no-total --collapse`,
    payees: (from: string) =>
        `payees -b ${from}`,
    incomeBalance: (symbol: string, yieldFrom: string, currency: string) =>
        `b ^Income and :${symbol}$ -b ${yieldFrom} --flat -X ${currency}`,
    gainLoss: (symbol: string, currency: string) =>
        `b ^Assets and :${symbol}$ -G -n -X ${currency}`,
    valueBalance: (symbol: string, currency: string) =>
        `b ^Assets and :${symbol}$ -X ${currency}`,
    basis: (symbol: string, currency: string) =>
        `b ^Assets and :${symbol}$ -B -n -X ${currency}`
}

const BeancountQueries: Queries = {
    /**
     * # is url-encoded (%23)
     * @returns accounts query
     */
    accounts: () => 
        'SELECT sum(number), currency, account ORDER BY account',
        //'SELECT account FROM %23accounts WHERE close IS NULL',
    openAccounts: () =>
        'SELECT account from #accounts where close is not null',
    balances: () =>
        'SELECT account, sum(number), currency ORDER BY account',
    currentValues: (rootAccount: string, currency: string) =>
        `SELECT account, str(CONVERT(value(sum(position)), '${currency}')) \
        WHERE account ~ '^${rootAccount}' \
        GROUP BY account \
        HAVING NOT empty(sum(position)) \
        ORDER BY account`,
    lots: (symbol: string) =>
        'balances',
    payees: (from: string) =>
        `SELECT DISTINCT(COALESCE(payee, narration)) as payee FROM transactions \
         WHERE date >= ${from} ORDER BY payee`,
    /**
     * Income balance for symbol
     * @returns Income from the security.
     */
    incomeBalance: (symbol: string, yieldFrom: string, currency: string) =>
        `SELECT str(CONVERT(value(sum(position)), '${currency}')) as balance, account \
        WHERE account ~ '^Income.*:${symbol}$' \
            AND date >= ${yieldFrom}`,
    gainLoss: (symbol: string, currency: string) =>
        // No subtraction on Inventories.
        // value(sum(position)) - cost(sum(position)) AS unrealized_gain \
        `SELECT account, \
            sum(position) AS units, \
            cost(sum(position)) AS cost_basis, \
            value(sum(position)) AS market_value \
        WHERE account ~ '^Assets:.*:${symbol}$' \
        GROUP BY account`,
    valueBalance: (symbol: string, currency: string) => {
        // convert the symbol to the account-name-compatible form.
        symbol = symbol.replace('.', '-')
        //`b ^Assets and :${symbol}$ -X ${currency}`,
        return `select str(convert(sum(position), '${currency}')), account \
                where account ~ 'Assets.*:${symbol}$'`
    },
    basis: (symbol: string, currency: string) =>
        `b ^Assets and :${symbol}$ -B -n -X ${currency}`
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
