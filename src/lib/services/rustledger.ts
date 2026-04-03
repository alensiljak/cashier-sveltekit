/**
 * RustLedger WASM Service
 * Provides Beancount parsing functionality using @rustledger/wasm
 */

import { Account } from '$lib/data/model';
import type { ParsedLedger, ParseResult, ValidationResult } from '@rustledger/wasm';
import wasmUrl from '@rustledger/wasm/rustledger_wasm_bg.wasm?url';

// WASM module instance
let wasmModule: typeof import('@rustledger/wasm') | null = null;
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
export function createParsedLedger(source: string): ParsedLedger | null {
	if (!wasmModule || !wasmModule.ParsedLedger) {
		return null;
	}
	return new wasmModule.ParsedLedger(source);
}

/**
 * Parse multiple Beancount files with include resolution.
 * @param files - Map of filename → file contents
 * @param entryPoint - The main file to start from (must be a key in files)
 */
export function parseMultiFile(files: Record<string, string>, entryPoint: string): ParseResult {
	if (!wasmModule || !wasmModule.parseMultiFile) {
		throw new Error('WASM module not available or parseMultiFile() not supported');
	}
	return wasmModule.parseMultiFile(files, entryPoint) as ParseResult;
}

/**
 * Parse source and return ParseResult from WASM.
 */
export function parseSource(source: string): ParseResult {
	if (!wasmModule || !wasmModule.parse) {
		throw new Error('WASM module not available. RustLedger requires WASM to be initialized.');
	}

	return wasmModule.parse(source) as ParseResult;
}

type QueryRow = Array<any>;

function getQueryErrorsMessage(query: string, errors: Array<{ message: string }>): string {
	return `BQL query failed for "${query}": ${errors.map((error) => error.message).join('; ')}`;
}

function getStringCell(row: QueryRow, columnIndex: number, columnName: string): string {
	const value = row[columnIndex];
	if (typeof value !== 'string') {
		throw new Error(`Expected string value for BQL column "${columnName}".`);
	}
	return value;
}

function extractAccountBalances(cell: any): Record<string, number> {
	const balances: Record<string, number> = {};

	if (!cell || typeof cell !== 'object') {
		return balances;
	}

	if (Array.isArray(cell.positions)) {
		for (const position of cell.positions) {
			if (position?.units?.currency && position.units.number != null) {
				balances[position.units.currency] = parseFloat(position.units.number);
			}
		}
		return balances;
	}

	if (cell.units?.currency && cell.units.number != null) {
		balances[cell.units.currency] = parseFloat(cell.units.number);
		return balances;
	}

	if (cell.currency && cell.number != null) {
		balances[cell.currency] = parseFloat(cell.number);
	}

	return balances;
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
 * Query all accounts and balances from an existing ParsedLedger instance.
 * This includes only accounts from the existing transactions!
 */
export function getAccountsFromTransactions(ledger: any): Account[] {
	const query = 'SELECT account, sum(position) AS balance GROUP BY account ORDER BY account';
	const result = ledger.query(query);
	if (result.errors.length > 0) {
		throw new Error(getQueryErrorsMessage(query, result.errors));
	}

	const accountColumnIndex = result.columns.indexOf('account');
	if (accountColumnIndex === -1) {
		throw new Error('BQL query did not return an "account" column.');
	}
	const balanceColumnIndex = result.columns.indexOf('balance');

	return result.rows.map((row: QueryRow) => {
		const account = new Account('');
		account.name = getStringCell(row, accountColumnIndex, 'account');
		if (balanceColumnIndex !== -1) {
			const balances = extractAccountBalances(row[balanceColumnIndex]);
			if (Object.keys(balances).length > 0) {
				account.balances = balances;
			}
		}
		return account;
	});
}

/**
 * Parse all unique accounts from Beancount source without filtering
 */
export function parseAllAccounts(source: string): Account[] {
	if (!wasmModule || !wasmModule.ParsedLedger) {
		throw new Error('WASM module not available. RustLedger requires WASM to be initialized.');
	}

	const ledger = new wasmModule.ParsedLedger(source);

	try {
		const query = 'SELECT account, sum(position) AS balance GROUP BY account ORDER BY account';
		const result = ledger.query(query);
		if (result.errors.length > 0) {
			throw new Error(getQueryErrorsMessage(query, result.errors));
		}

		const accountColumnIndex = result.columns.indexOf('account');
		if (accountColumnIndex === -1) {
			throw new Error('BQL query did not return an "account" column.');
		}
		const balanceColumnIndex = result.columns.indexOf('balance');

		return result.rows.map((row: QueryRow) => {
			const account = new Account('');
			account.name = getStringCell(row, accountColumnIndex, 'account');
			if (balanceColumnIndex !== -1) {
				const balances = extractAccountBalances(row[balanceColumnIndex]);
				if (Object.keys(balances).length > 0) {
					account.balances = balances;
				}
			}
			return account;
		});
	} finally {
		ledger.free();
	}
}

/**
 * Get the WASM library version
 */
export function version(): string {
	if (!wasmModule || !wasmModule.version) {
		throw new Error('WASM module not available or version() not supported');
	}
	return wasmModule.version();
}

/**
 * Validate a Beancount source string using WASM.
 * Parses, interpolates, and validates in one step without allocating a full ParsedLedger.
 */
export function validateSource(source: string): ValidationResult {
	if (!wasmModule || !wasmModule.validateSource) {
		throw new Error('WASM module not available or validateSource() not supported');
	}
	return wasmModule.validateSource(source) as ValidationResult;
}

/**
 * Format a Beancount source string using WASM.
 * Parses and reformats with consistent alignment.
 */
export function format(source: string): { formatted?: string; errors: any[] } {
	if (!wasmModule || !wasmModule.format) {
		throw new Error('WASM module not available or format() not supported');
	}
	return wasmModule.format(source);
}

// Default export
export default {
	ensureInitialized,
	parseBalanceSheetRow,
	createParsedLedger,
	getAccountsFromTransactions,
	parseSource,
	parseMultiFile,
	validateSource,
	format,
	version
};
