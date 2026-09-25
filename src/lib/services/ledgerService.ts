import { writable, derived, type Readable } from 'svelte/store';
import {
	ensureInitialized,
	createParsedLedger,
	format as formatWasm,
	getAccountsFromTransactions,
	version as wasmVersion
} from './rustledger';
import type { DirectiveJson as Directive, BeancountError, ParsedLedger } from '@rustledger/wasm';
import { Account, Xact } from '$lib/data/model';
import { directiveToXact } from '$lib/utils/transactionParser';
import { getXactStore } from '$lib/storage/xactStoreRegistry';
import type { StoredXact, XactId } from '$lib/storage/xactStore';

interface QueryError {
	message: string;
	severity: string;
	line: number;
	column: number;
}

interface QueryResult {
	columns: string[];
	rows: any[];
	errors: QueryError[];
}

/**
 * LedgerService manages the lifecycle of the ParsedLedger instance,
 * provides methods to load/invalidate/query the ledger,
 * and exposes a version store for reactive updates.
 * It also includes helper methods for formatting and parsing Beancount source strings.
 */
class LedgerService {
	private ledger: any = null;
	private _version = writable(0);
	readonly version: Readable<number> = derived(this._version, (v) => v);

	/** Ensure WASM is initialized */
	async ensureInitialized(): Promise<void> {
		await ensureInitialized();
	}

	/** Get WASM library version string */
	getWasmVersion(): string {
		return wasmVersion();
	}

	/** Read OPFS → combine → create ParsedLedger. */
	async load(): Promise<void> {
		await ensureInitialized();
		const combinedSource = await this.readAndCombineSources();

		this.ledger = createParsedLedger(combinedSource);

		this._version.update((v) => v + 1);
	}

	/** Free old ledger, re-read cashier.bean, recombine, create new ParsedLedger, bump version. */
	async invalidate(): Promise<void> {
		if (this.ledger) {
			this.ledger.free();
			this.ledger = null;
		}
		await this.load();
	}

	/** Run a BQL query, return { columns, rows }. */
	query(bql: string): QueryResult {
		if (!this.ledger) throw new Error('Ledger not loaded');
		return this.ledger.query(bql);
	}

	/** Return parsed directives (transactions, balances, opens, …). */
	getDirectives(): Directive[] {
		if (!this.ledger) return [];
		return this.ledger.getDirectives();
	}

	/** Get parse errors from the current ledger */
	getParseErrors(): BeancountError[] {
		if (!this.ledger) return [];
		return this.ledger.getParseErrors();
	}

	/** Get validation errors from the current ledger */
	getValidationErrors(): BeancountError[] {
		if (!this.ledger) return [];
		return this.ledger.getValidationErrors();
	}

	/** Check if the current ledger is valid */
	isValid(): boolean {
		if (!this.ledger) return false;
		return this.ledger.isValid();
	}

	/** Stateless: format a Beancount source string. */
	format(source: string): { formatted?: string; errors: BeancountError[] } {
		return formatWasm(source);
	}

	/** Append a transaction to the working-set store, then invalidate. Returns its location. */
	async appendTransaction(beancountText: string): Promise<StoredXact> {
		const location = await getXactStore().append(beancountText);
		await this.invalidate();
		return location;
	}

	/** Replace the transaction identified by `id`, then invalidate. Returns its new location. */
	async editTransaction(id: XactId, newBeancountText: string): Promise<StoredXact> {
		const location = await getXactStore().update(id, newBeancountText);
		await this.invalidate();
		return location;
	}

	/** Delete the transaction identified by `id`, then invalidate. */
	async deleteTransaction(id: XactId): Promise<void> {
		await getXactStore().remove(id);
		await this.invalidate();
	}

	/** Delete every transaction in the working-set store, then invalidate. */
	async clearTransactions(): Promise<void> {
		await getXactStore().clear();
		await this.invalidate();
	}

	/** Parse a provided Beancount source string and set as the current ledger. */
	parseSource(source: string): void {
		if (this.ledger) {
			this.ledger.free();
		}
		this.ledger = createParsedLedger(source);
		this._version.update((v) => v + 1);
	}

	/** Create a new ParsedLedger instance from source (does not set as current ledger) */
	createParsedLedger(source: string): ParsedLedger | null {
		return createParsedLedger(source);
	}

	/** Get all accounts with balances from the current ledger. */
	getAccounts(): Account[] {
		if (!this.ledger) return [];
		return getAccountsFromTransactions(this.ledger);
	}

	/**
	 * Get all declared accounts from the current ledger, including those with
	 * no transactions.
	 * Merges open-directive accounts with BQL balance results.
	 */
	getAllAccounts(): Account[] {
		if (!this.ledger) return [];

		// Collect all accounts declared via `open` directives, excluding closed ones.
		const directives: any[] = this.ledger.getDirectives();
		const closedAccountNames = new Set<string>(
			directives.filter((d) => d.type === 'close').map((d) => d.account)
		);
		const openAccountNames = new Set<string>(
			directives
				.filter((d) => d.type === 'open' && !closedAccountNames.has(d.account))
				.map((d) => d.account)
		);

		// Get accounts that have transactions (with balances).
		const txAccounts = getAccountsFromTransactions(this.ledger);
		const txAccountMap = new Map<string, Account>(txAccounts.map((a) => [a.name, a]));

		// Merge: start from all open accounts, overlay balances where present.
		const all = new Map<string, Account>();
		for (const name of openAccountNames) {
			all.set(name, txAccountMap.get(name) ?? new Account(name));
		}
		// Also include any accounts in transactions that lack an open directive (but aren't closed).
		for (const account of txAccounts) {
			if (!all.has(account.name) && !closedAccountNames.has(account.name)) {
				all.set(account.name, account);
			}
		}

		return Array.from(all.values()).sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Get accounts from a ParsedLedger instance */
	getAccountsFromTransactions(ledger: any): Account[] {
		return getAccountsFromTransactions(ledger);
	}

	/** Get all transactions from the current ledger as Xact objects. */
	getXacts(): Xact[] {
		if (!this.ledger) return [];
		const directives: any[] = this.ledger.getDirectives();
		return directives.filter((d) => d.type === 'transaction').map((d) => this.directiveToXact(d));
	}

	/** Working-set source from the active store. */
	private async readAndCombineSources(): Promise<string> {
		return getXactStore().toBeancount();
	}

	/**
	 * All working-set transactions paired with their store IDs (used by the journal
	 * to populate the list and supply the ID needed for editing).
	 */
	async getStoredXacts(): Promise<StoredXact[]> {
		return getXactStore().list();
	}

	private directiveToXact = directiveToXact;

	/** Free the current ledger instance */
	free(): void {
		if (this.ledger) {
			this.ledger.free();
			this.ledger = null;
		}
	}
}

const ledgerService = new LedgerService();
export default ledgerService;
