/**
 * RustLedger WASM Service
 * Provides Beancount parsing functionality using @rustledger/wasm
 */

import type { CurrentValuesDict } from '$lib/data/viewModels';
import { Account, Money } from '$lib/data/model';
import wasmUrl from '@rustledger/wasm/rustledger_wasm_bg.wasm?url';

// WASM module instance
let wasmModule: any = null;
let initPromise: Promise<void> | null = null;

// Track which implementation was used for each function
export let lastParseBalanceSheetRowSource: 'wasm' | 'js' | null = null;
export let lastParseCurrentValuesSource: 'wasm' | 'js' | null = null;
export let lastGetMoneyFromTupleStringSource: 'wasm' | 'js' | null = null;
export let lastGetNumberFromBalanceRowSource: 'wasm' | 'js' | null = null;

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

			// Let Vite resolve the package asset URL.
			// In dev this is served from node_modules, and in production it is emitted
			// as a build asset with the correct final URL.
			await rustledger.default({ module_or_path: wasmUrl });

			wasmModule = rustledger;
			console.log('RustLedger WASM module loaded and initialized successfully');
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
 * Check if WASM module is available
 */
export function isWasmAvailable(): boolean {
	return wasmModule !== null && wasmModule.ParsedLedger !== undefined;
}

/**
 * Create a ParsedLedger instance if WASM is available
 */
export function createParsedLedger(source: string): any {
	if (!wasmModule || !wasmModule.ParsedLedger) {
		return null;
	}
	return new wasmModule.ParsedLedger(source);
}

/**
 * Parse Beancount balance sheet output using WASM ParsedLedger
 * Expected format: array of rows, each row is [amount, currency, account_name]
 */
export function parseBalanceSheetRow(record: string[]): Account | null {
	if (!wasmModule || !wasmModule.ParsedLedger) {
		lastParseBalanceSheetRowSource = 'js';
		return parseBalanceSheetRowJS(record);
	}

	try {
		// Build a minimal Beancount source from the record
		// Format: <date> * "Transaction" "Description"
		//        <account> <amount> <currency>
		const source = `2024-01-01 * "Generated" "From record"
    ${record[2]} ${record[0]} ${record[1]}`;

		const ledger = new wasmModule.ParsedLedger(source);
		const directives = ledger.getDirectives();

		// Find the transaction and extract the posting for our account
		for (const directive of directives) {
			if (directive.type === 'transaction') {
				for (const posting of directive.postings) {
					if (posting.account === record[2]) {
						const account = new Account('');
						account.name = posting.account;
						account.balances = { [posting.units.currency]: parseFloat(posting.units.number) };
						ledger.free();
						lastParseBalanceSheetRowSource = 'wasm';
						return account;
					}
				}
			}
		}

		ledger.free();
	} catch (error) {
		console.warn('WASM parse failed, falling back to JS:', error);
	}

	// Fallback to JavaScript implementation
	lastParseBalanceSheetRowSource = 'js';
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
 * Parse Beancount current values using WASM ParsedLedger
 * Expected format: array of rows, each row is [amount_string, currency, account_name]
 * The function filters accounts under the specified rootAccount.
 */
export function parseCurrentValues(lines: Array<any>, rootAccount: string): CurrentValuesDict {
	if (!wasmModule || !wasmModule.ParsedLedger) {
		lastParseCurrentValuesSource = 'js';
		return parseCurrentValuesJS(lines, rootAccount);
	}

	const result: CurrentValuesDict = {};

	try {
		// Build Beancount source from lines
		const source = buildBeancountSourceFromLines(lines);

		const ledger = new wasmModule.ParsedLedger(source);
		const directives = ledger.getDirectives();

		// Process all transactions to extract balances
		for (const directive of directives) {
			if (directive.type === 'transaction') {
				for (const posting of directive.postings) {
					const account = posting.account;
					if (rootAccount && !account.startsWith(rootAccount)) {
						continue;
					}
					if (posting.units) {
						result[account] = {
							quantity: parseFloat(posting.units.number),
							currency: posting.units.currency
						};
					}
				}
			} else if (directive.type === 'balance') {
				const account = directive.account;
				if (rootAccount && !account.startsWith(rootAccount)) {
					continue;
				}
				result[account] = {
					quantity: parseFloat(directive.amount.number),
					currency: directive.amount.currency
				};
			}
		}

		ledger.free();
		lastParseCurrentValuesSource = 'wasm';
		return result;
	} catch (error) {
		console.warn('WASM parse failed, falling back to JS:', error);
	}

	// Fallback to JavaScript implementation
	lastParseCurrentValuesSource = 'js';
	return parseCurrentValuesJS(lines, rootAccount);
}

/**
 * Build a Beancount source string from parsed lines
 */
function buildBeancountSourceFromLines(lines: Array<any>): string {
	const sourceLines: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const row = lines[i];
		if (Array.isArray(row) && row.length >= 3) {
			// Format: [amount, currency, account]
			const [amount, currency, account] = row;
			sourceLines.push(`2024-01-01 * "Transaction ${i}" "Generated"`);
			sourceLines.push(`    ${account} ${amount} ${currency}`);
		} else if (Array.isArray(row) && row.length === 2) {
			// Tuple format: [account, "(amount currency)"]
			const [account, amountStr] = row;
			sourceLines.push(`2024-01-01 * "Transaction ${i}" "Generated"`);
			sourceLines.push(`    ${account} ${amountStr}`);
		}
	}

	return sourceLines.join('\n');
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
	if (!wasmModule || !wasmModule.ParsedLedger) {
		lastGetMoneyFromTupleStringSource = 'js';
		return getMoneyFromTupleStringJS(value);
	}

	try {
		// Use ParsedLedger to parse the amount
		const source = `2024-01-01 * "Test" "Parse amount"
    Assets:Test ${value}`;
		const ledger = new wasmModule.ParsedLedger(source);
		const directives = ledger.getDirectives();

		if (directives.length > 0 && directives[0].type === 'transaction') {
			const posting = directives[0].postings[0];
			if (posting && posting.units) {
				const money = new Money();
				money.quantity = parseFloat(posting.units.number);
				money.currency = posting.units.currency;
				ledger.free();
				lastGetMoneyFromTupleStringSource = 'wasm';
				return money;
			}
		}

		ledger.free();
	} catch (error) {
		console.warn('WASM parse failed, falling back to JS:', error);
	}

	// Fallback to JavaScript implementation
	lastGetMoneyFromTupleStringSource = 'js';
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
	if (!wasmModule || !wasmModule.ParsedLedger) {
		lastGetNumberFromBalanceRowSource = 'js';
		return getNumberFromBalanceRowJS(row);
	}

	try {
		// Use ParsedLedger to parse
		if (row.length > 0) {
			const tuple = row[0][0];
			const source = `2024-01-01 * "Test" "Parse amount"
    Assets:Test ${tuple}`;
			const ledger = new wasmModule.ParsedLedger(source);
			const directives = ledger.getDirectives();

			if (directives.length > 0 && directives[0].type === 'transaction') {
				const posting = directives[0].postings[0];
				if (posting && posting.units) {
					const result = parseFloat(posting.units.number);
					ledger.free();
					lastGetNumberFromBalanceRowSource = 'wasm';
					return result;
				}
			}

			ledger.free();
		}
	} catch (error) {
		console.warn('WASM parse failed, falling back to JS:', error);
	}

	// Fallback to JavaScript implementation
	lastGetNumberFromBalanceRowSource = 'js';
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
	getNumberFromBalanceRow,
	isWasmAvailable,
	createParsedLedger
};
