/**
 * RustLedger WASM Service
 * Provides Beancount parsing functionality using @rustledger/wasm
 */

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
 * Parse all unique accounts from Beancount source without filtering
 */
export function parseAllAccounts(source: string): Account[] {
	if (!wasmModule || !wasmModule.ParsedLedger) {
		throw new Error('WASM module not available. RustLedger requires WASM to be initialized.');
	}

	const ledger = new wasmModule.ParsedLedger(source);

	try {
		const accountsQuery = 'SELECT DISTINCT account';
		const accountsResult = ledger.query(accountsQuery);
		if (accountsResult.errors.length > 0) {
			throw new Error(getQueryErrorsMessage(accountsQuery, accountsResult.errors));
		}

		const accountColumnIndex = accountsResult.columns.indexOf('account');
		if (accountColumnIndex === -1) {
			throw new Error('BQL accounts query did not return an "account" column.');
		}

		const balancesQuery = 'BALANCES';
		const balancesResult = ledger.query(balancesQuery);
		if (balancesResult.errors.length > 0) {
			throw new Error(getQueryErrorsMessage(balancesQuery, balancesResult.errors));
		}

		const balanceAccountColumnIndex = balancesResult.columns.indexOf('account');
		const balanceValueColumnIndex = balancesResult.columns.indexOf('balance');
		const balancesByAccount: Record<string, Record<string, number>> = {};

		if (balanceAccountColumnIndex !== -1 && balanceValueColumnIndex !== -1) {
			for (const row of balancesResult.rows) {
				const accountName = getStringCell(row, balanceAccountColumnIndex, 'account');
				const balances = extractAccountBalances(row[balanceValueColumnIndex]);
				if (Object.keys(balances).length > 0) {
					balancesByAccount[accountName] = balances;
				}
			}
		}

		return accountsResult.rows
			.map((row: QueryRow) => getStringCell(row, accountColumnIndex, 'account'))
			.sort((a: string, b: string) => a.localeCompare(b))
			.map((name: string) => {
				const account = new Account('');
				account.name = name;
				if (balancesByAccount[name]) {
					account.balances = balancesByAccount[name];
				}
				return account;
			});
	} finally {
		ledger.free();
	}
}

function normalizeTupleAmountString(value: string): string {
	return value
		.trim()
		.replace(/^\((.*)\)$/, '$1')
		.trim();
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

/**
 * Get the WASM library version
 */
export function version(): string {
	if (!wasmModule || !wasmModule.version) {
		throw new Error('WASM module not available or version() not supported');
	}
	return wasmModule.version();
}

// Default export
export default {
	ensureInitialized,
	parseBalanceSheetRow,
	getMoneyFromTupleString,
	getNumberFromBalanceRow,
	createParsedLedger,
	version
};
