/**
 * Contains queries for the sync, PTA system.
 */

import { PtaSystems } from '$lib/enums';

export interface Queries {
	accounts(): string;
	openAccounts(): string;
	balances(): string;
	currentValues(rootAccount: string, currency: string): string;
	lots(symbol: string): string;
	payees(from: string): string;
	incomeBalance(symbol: string, yieldFrom: string, currency: string): string;
	gainLoss(symbol: string, currency: string): string;
	valueBalance(symbol: string, currency: string): string;
	basis(symbol: string, currency: string): string;
}

const LedgerQueries: Queries = {
	accounts: () => 'b --flat --empty --no-total',
	/**
	 * This functionality does not exist with Ledger.
	 */
	openAccounts: () => 'b --flat --no-total',
	balances: () => 'b --flat --no-total',
	currentValues: (rootAccount: string, currency: string) =>
		`b ^${rootAccount} -X ${currency} --flat --no-total`,
	lots: (symbol: string) => `b ^Assets and invest and :${symbol}$ --lots --no-total --collapse`,
	payees: (from: string) => `payees -b ${from}`,
	incomeBalance: (symbol: string, yieldFrom: string, currency: string) =>
		`b ^Income and :${symbol}$ -b ${yieldFrom} --flat -X ${currency}`,
	gainLoss: (symbol: string, currency: string) => `b ^Assets and :${symbol}$ -G -n -X ${currency}`,
	valueBalance: (symbol: string, currency: string) => `b ^Assets and :${symbol}$ -X ${currency}`,
	basis: (symbol: string, currency: string) => `b ^Assets and :${symbol}$ -B -n -X ${currency}`
};

const BeancountQueries: Queries = {
	/**
	 * # is url-encoded (%23)
	 * @returns accounts query
	 */
	accounts: () => 'SELECT sum(number), currency, account ORDER BY account',
	openAccounts: () => 'SELECT account from #accounts where close is null',
	balances: () => 'SELECT account, sum(number), currency ORDER BY account',
	currentValues: (rootAccount: string, currency: string) =>
		`SELECT account, str(CONVERT(value(sum(position)), '${currency}'))
        WHERE account ~ '^${rootAccount}'
        GROUP BY account
        HAVING NOT empty(sum(position))
        ORDER BY account`,
	lots: (symbol: string) => 'balances',
	payees: (from: string) =>
		`SELECT DISTINCT COALESCE(payee, narration) as payee FROM transactions \
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
		// account, \
		// str(sum(position)) AS units, \
		`SELECT 
            str(convert(cost(sum(position)), '${currency}')) AS cost_basis, \
            str(convert(value(sum(position)), '${currency}')) AS market_value \
        WHERE currency = '${symbol}'`,
	valueBalance: (symbol: string, currency: string) => {
		// convert the symbol to the account-name-compatible form.
		// symbol = symbol.replace('.', '-')
		return `select str(convert(sum(position), '${currency}')) \
                where currency = '${symbol}'`;
	},
	basis: (symbol: string, currency: string) => `b ^Assets and :${symbol}$ -B -n -X ${currency}`
};

const RustledgerQueries: Queries = {
	/**
	 * # is url-encoded (%23)
	 * @returns accounts query
	 */
	accounts: () => 'SELECT sum(number) as balance, currency, account ORDER BY account',
	openAccounts: () => 'SELECT account, open, currencies from #accounts where close is null',
	balances: () => 'SELECT account, sum(number) as balance, currency ORDER BY account',
	currentValues: (rootAccount: string, currency: string) =>
		`SELECT account, str(value(sum(position), '${currency}')) as value
        WHERE account ~ '^${rootAccount}'
        GROUP BY account
        HAVING number(value(sum(position), 'EUR')) != 0
        ORDER BY account`,
	// HAVING NOT empty(sum(position))
	lots: (symbol: string) => 'balances',
	payees: (from: string) =>
		`SELECT DISTINCT COALESCE(payee, narration) as payee FROM transactions \
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
		`SELECT 
            str(convert(cost(sum(position)), '${currency}')) AS cost_basis, \
            str(convert(value(sum(position)), '${currency}')) AS market_value \
        WHERE currency = '${symbol}'`,
	valueBalance: (symbol: string, currency: string) => {
		// convert the symbol to the account-name-compatible form.
		// symbol = symbol.replace('.', '-')
		return `select str(convert(sum(position), '${currency}')) \
                where currency = '${symbol}'`;
	},
	basis: (symbol: string, currency: string) => `b ^Assets and :${symbol}$ -B -n -X ${currency}`
};

export function getQueries(ptaSystem: string): Queries {
	if (ptaSystem === PtaSystems.ledger) {
		return LedgerQueries;
	} else if (ptaSystem == PtaSystems.beancount) {
		return BeancountQueries;
	} else if (ptaSystem == PtaSystems.rledger) {
		return RustledgerQueries;
	} else {
		throw new Error('Unknown PTA system: ' + ptaSystem);
	}
}
