/**
 * Parses Rust Ledger output
 */
//import { Account } from '$lib/data/model';
import { Account, Money } from '$lib/data/model';
import type { CurrentValuesDict } from '$lib/data/viewModels';

function parseBalanceSheetRow(record: Record<string, string>): Account {
	const account = new Account('');
	const accountBalances: Record<string, number> = {};

	// currency
	const currency = record.currency;

	// amount
	const amount = record.balance;
	accountBalances[currency] = parseFloat(amount);

	// name
	const name = record.account;
	account.name = name;

	// Once we have the name, assign the balances dictionary and keep for update.
	account.balances = accountBalances;

	return account;
}

function parseCurrentValues(response: any): CurrentValuesDict {
	// The return value { "account": amount }
	const result: CurrentValuesDict = {};

	response.rows.forEach((row: any) => {
		const account: string = row.account;
		const amountString: string = row.str;
		const amount = Money.fromString(amountString);
		result[account] = amount;
	});

	return result;
}

export {
	parseBalanceSheetRow,
	parseCurrentValues
	// getNumberFromBalanceRow,
	// getMoneyFromTupleString
};
