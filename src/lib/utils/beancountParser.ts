/**
 * Parses Beancount output
 */
import { Account, Money } from '$lib/data/model';
import type { AccountWithBalance, CurrentValuesDict } from '$lib/data/viewModels';

/**
 * Creates an Account object from a Beancount balance sheet record.
 * @param record The record to parse
 * @returns populated Account object
 */
function parseBalanceSheetRow(record: string[]): Account | null {
	const account = new Account('');
	const accountBalances: Record<string, number> = {};

	// currency
	const currency = record[1];
	// account.cu

	// amount
	const amount = record[0];
	// account.
	accountBalances[currency] = parseFloat(amount);

	// name
	const name = record[2];
	account.name = name;

	// Once we have the name, assign the balances dictionary and keep for update.
	account.balances = accountBalances;

	return account;
}

/**
 * Parses a standard balance row
 * [
 *    "(-127.68 EUR)",
 *    "Income:Investment:Dividend:MMLP-MI"
 * ]
 */
function getNumberFromBalanceRow(row: Array<string>): number {
	if (row.length === 0) return 0;
	const record = row[0];
	const amount_str = record[0];

	const amount: Money = Money.fromString(amount_str);
	return amount.quantity;
}

/**
 * Extracts the numeric value from a column value (position).
 * @param value String of a tuple with a column value. Example: '(594.52 USD)'
 * @returns number from the tuple
 */
function getMoneyFromTupleString(value: string): Money {
	value = value.replace('(', '');
	value = value.replace(')', '');

	const result = Money.fromString(value);
	return result;
}

/**
 *
 * @param lines Array of records. Result returned from Cashier Server.
 * @param rootAccount
 * @returns
 */
function parseCurrentValues(lines: Array<any>, rootAccount: string): CurrentValuesDict {
	// The return value { "account": amount }
	const result: CurrentValuesDict = {};
	for (const row of lines) {
		const account = row[0];

		// At this point we should have only one balance in the
		// common currency.
		const balanceString = row[1];
		const balance = getMoneyFromTupleString(balanceString);

		// add to the dictionary
		result[account] = { quantity: balance.quantity, currency: balance.currency };
	}

	return result;
}

export {
	parseBalanceSheetRow,
	parseCurrentValues,
	getNumberFromBalanceRow,
	getMoneyFromTupleString
};
