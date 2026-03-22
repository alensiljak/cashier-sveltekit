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

			// Store the module (contains ParsedLedger class and other exports)
			wasmModule = rustledger;
			console.log('RustLedger WASM module loaded and initialized successfully');
		} catch (error) {
			initPromise = null;
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
		throw new Error('WASM module not available. RustLedger requires WASM to be initialized.');
	}

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
					return account;
				}
			}
		}
	}

	ledger.free();
	return null;
}

/**
 * Parse Beancount current values using WASM ParsedLedger
 * Expected format: array of rows, each row is [amount_string, currency, account_name]
 * The function filters accounts under the specified rootAccount.
 */
export function parseCurrentValues(lines: Array<any>, rootAccount: string): CurrentValuesDict {
	if (!wasmModule || !wasmModule.ParsedLedger) {
		throw new Error('WASM module not available. RustLedger requires WASM to be initialized.');
	}

	const result: CurrentValuesDict = {};

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
	return result;
}

/**
 * Build a Beancount source string from parsed lines
 */
function buildBeancountSourceFromLines(lines: Array<any>): string {
	const transactionHeader = (i: number) => `2024-01-01 * "Transaction ${i}" "Generated"`;

	const sourceLines = lines.flatMap((row, i) => {
		if (!Array.isArray(row) || row.length < 2) return [];

		let account: string;
		let amount: string;

		if (row.length >= 3) {
			// Format: [amount, currency, account]
			const [amountVal, currency, accountVal] = row;
			account = accountVal;
			amount = `${amountVal} ${currency}`;
		} else {
			// Tuple format: [account, "(amount currency)"]
			[account, amount] = row;
			amount = normalizeTupleAmountString(amount);
		}

		return [transactionHeader(i), `    ${account} ${amount}`];
	});

	return sourceLines.join('\n');
}

function normalizeTupleAmountString(value: string): string {
	return value.trim().replace(/^\((.*)\)$/, '$1').trim();
}

/**
 * Extract numeric value from a balance row tuple string
 * Example: "(594.52 USD)" -> Money object
 */
export function getMoneyFromTupleString(value: string): Money {
	if (!wasmModule || !wasmModule.ParsedLedger) {
		throw new Error('WASM module not available. RustLedger requires WASM to be initialized.');
	}

	// Use ParsedLedger to parse the amount
	const normalizedValue = normalizeTupleAmountString(value);
	const source = `2024-01-01 * "Test" "Parse amount"
    Assets:Test ${normalizedValue}`;
	const ledger = new wasmModule.ParsedLedger(source);
	const directives = ledger.getDirectives();

	if (directives.length > 0 && directives[0].type === 'transaction') {
		const posting = directives[0].postings[0];
		if (posting && posting.units) {
			const money = new Money();
			money.quantity = parseFloat(posting.units.number);
			money.currency = posting.units.currency;
			ledger.free();
			return money;
		}
	}

	ledger.free();
	throw new Error('Failed to parse money from tuple string using WASM');
}

/**
 * Get the numeric value from a balance row
 */
export function getNumberFromBalanceRow(row: Array<Array<string>>): number {
	if (!wasmModule || !wasmModule.ParsedLedger) {
		throw new Error('WASM module not available. RustLedger requires WASM to be initialized.');
	}

	// Use ParsedLedger to parse
	if (row.length > 0) {
		const tuple = normalizeTupleAmountString(row[0][0]);
		const source = `2024-01-01 * "Test" "Parse amount"
    Assets:Test ${tuple}`;
		const ledger = new wasmModule.ParsedLedger(source);
		const directives = ledger.getDirectives();

		if (directives.length > 0 && directives[0].type === 'transaction') {
			const posting = directives[0].postings[0];
			if (posting && posting.units) {
				const result = parseFloat(posting.units.number);
				ledger.free();
				return result;
			}
		}

		ledger.free();
	}

	throw new Error('Failed to parse number from balance row using WASM');
}

// Default export
export default {
	ensureInitialized,
	parseBalanceSheetRow,
	parseCurrentValues,
	getMoneyFromTupleString,
	getNumberFromBalanceRow,
	createParsedLedger
};
