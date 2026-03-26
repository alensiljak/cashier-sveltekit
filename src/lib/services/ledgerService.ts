import { writable, derived, type Readable } from 'svelte/store';
import {
	ensureInitialized,
	createParsedLedger,
	format as formatWasm,
	getAccountsFromLedger,
	version as wasmVersion
} from './rustledger';
import type { Directive, BeancountError } from '@rustledger/wasm';
import { Account } from '$lib/data/model';

interface QueryResult {
	columns: string[];
	rows: any[];
}

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

	/** Append a formatted transaction to cashier.bean → invalidate. */
	async appendTransaction(beancountText: string): Promise<void> {
		// TODO: Append to cashier.bean in OPFS, then invalidate
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
	createParsedLedger(source: string): any {
		return createParsedLedger(source);
	}

	/** Get accounts from a ParsedLedger instance */
	getAccountsFromLedger(ledger: any): Account[] {
		return getAccountsFromLedger(ledger);
	}

	/** Helper: Read and combine all .bean sources from OPFS */
	private async readAndCombineSources(): Promise<string> {
		// TODO: Implement OPFS file reading and concatenation logic
		return '';
	}

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
