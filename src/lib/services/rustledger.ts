/**
 * RustLedger WASM Service
 * Provides Beancount parsing functionality using @rustledger/wasm
 */

import type { CurrentValuesDict } from '$lib/data/viewModels';
import { Account, Money } from '$lib/data/model';

// WASM module instance
let wasmModule: any = null;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the WASM module
 */
async function initWasm(): Promise<void> {
	if (wasmModule) return;
	if (initPromise) return initPromise;

	initPromise = (async () => {
		try {
			// Dynamically import the WASM package
			const rustledger = await import('@rustledger/wasm');
			wasmModule = rustledger;
			console.log('RustLedger WASM module loaded successfully');
		} catch (error) {
			console.error('Failed to load RustLedger WASM module:', error);
			throw error;
		}
	})();

	return initPromise;
}

/**
 * Ensure WASM is initialized
 */
export async function ensureInitialized(): Promise<void> {
	await initWasm();
}

/**
 * Parse Beancount balance sheet output
 * Expected format: array of rows, each row is [amount, currency, account_name]
 */
export function parseBalanceSheetRow(record: string[]): Account | null {
	if (!wasmModule) {
		return parseBalanceSheetRowJS(record);
	}

	try {
		// Use WASM parsing if available, otherwise fallback to JS implementation
		if (wasmModule.parse_balance_sheet_row) {
			const result = wasmModule.parse_balance_sheet_row(record);
			const account = new Account('');
			account.name = result.account_name;
			account.balances = { [result.currency]: result.amount };
			return account;
		}
	} catch (error) {
		console.warn('WASM parse failed, falling back to JS:', error);
	}

	// Fallback to JavaScript implementation
	return parseBalanceSheetRowJS(record);
}

/**
 * JavaScript fallback implementation
 */
function parseBalanceSheetRowJS(record: string[]): Account | null {
	const account = new Account('');
	const accountBalances: Record<string, number> = {};

	const currency = record[1];
	const amount = record[0];
	accountBalances[currency] = parseFloat(amount);

	const name = record[2];
	account.name = name;

	account.balances = accountBalances;
	return account;
}

/**
 * Parse Beancount current values
 * Expected format: array of rows, each row is [amount_string, currency, account_name]
 * The function filters accounts under the specified rootAccount.
 * JavaScript fallback also supports tuple format [account, "(amount currency)"] for compatibility.
 */
export function parseCurrentValues(lines: Array<any>, rootAccount: string): CurrentValuesDict {
	if (!wasmModule) {
		return parseCurrentValuesJS(lines, rootAccount);
	}

	const result: CurrentValuesDict = {};

	try {
		// Use WASM parsing if available
		if (wasmModule.parse_current_values) {
			const parsed = wasmModule.parse_current_values(lines, rootAccount);
			for (const [account, data] of Object.entries(parsed)) {
				// Type assertion for WASM return data
				const moneyData = data as { quantity: number; currency: string };
				result[account] = {
					quantity: moneyData.quantity,
					currency: moneyData.currency
				};
			}
			return result;
		}
	} catch (error) {
		console.warn('WASM parse failed, falling back to JS:', error);
	}

	// Fallback to JavaScript implementation
	return parseCurrentValuesJS(lines, rootAccount);
}

/**
 * JavaScript fallback implementation
 * Supports two input formats:
 * 1. Beancount balance sheet format: [amount_string, currency, account_name]
 * 2. Tuple format: [account_name, "(amount currency)"]
 */
function parseCurrentValuesJS(lines: Array<any>, rootAccount: string): CurrentValuesDict {
	const result: CurrentValuesDict = {};

	for (const row of lines) {
		if (!Array.isArray(row) || row.length < 2) {
			continue;
		}

		let account: string;
		let balance: Money;

		if (row.length === 2) {
			// Tuple format: [account, balance_tuple]
			account = row[0];
			const balanceString = row[1];
			balance = getMoneyFromTupleString(balanceString);
		} else {
			// Beancount format: [amount_string, currency, account_name]
			const amountStr = row[0];
			const currencyStr = row[1];
			account = row[2];
			balance = Money.fromString(`${amountStr} ${currencyStr}`);
		}

		if (rootAccount && !account.startsWith(rootAccount)) {
			continue;
		}

		result[account] = { quantity: balance.quantity, currency: balance.currency };
	}

	return result;
}

/**
 * Extract numeric value from a balance row tuple string
 * Example: "(594.52 USD)" -> Money object
 */
export function getMoneyFromTupleString(value: string): Money {
	if (!wasmModule) {
		return getMoneyFromTupleStringJS(value);
	}

	try {
		// Use WASM parsing if available
		if (wasmModule.parse_money_tuple) {
			const result = wasmModule.parse_money_tuple(value);
			const money = new Money();
			money.quantity = result.quantity;
			money.currency = result.currency;
			return money;
		}
	} catch (error) {
		console.warn('WASM parse failed, falling back to JS:', error);
	}

	// Fallback to JavaScript implementation
	return getMoneyFromTupleStringJS(value);
}

/**
 * JavaScript fallback implementation
 */
function getMoneyFromTupleStringJS(value: string): Money {
	value = value.replace('(', '');
	value = value.replace(')', '');
	return Money.fromString(value);
}

/**
 * Get the numeric value from a balance row
 */
export function getNumberFromBalanceRow(row: Array<Array<string>>): number {
	if (!wasmModule) {
		return getNumberFromBalanceRowJS(row);
	}

	try {
		// Use WASM parsing if available
		if (wasmModule.get_number_from_balance_row) {
			return wasmModule.get_number_from_balance_row(row);
		}
	} catch (error) {
		console.warn('WASM parse failed, falling back to JS:', error);
	}

	// Fallback to JavaScript implementation
	return getNumberFromBalanceRowJS(row);
}

/**
 * JavaScript fallback implementation
 */
function getNumberFromBalanceRowJS(row: Array<Array<string>>): number {
	if (row.length === 0) return 0;
	const record = row[0];
	const amount_str = record[0];
	const amount: Money = Money.fromString(amount_str);
	return amount.quantity;
}

// Default export
export default {
	ensureInitialized,
	parseBalanceSheetRow,
	parseCurrentValues,
	getMoneyFromTupleString,
	getNumberFromBalanceRow
};
