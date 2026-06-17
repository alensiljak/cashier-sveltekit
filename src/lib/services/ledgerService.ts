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
import * as opfslib from '$lib/utils/opfslib';
import {
	mapDirectiveSpans,
	replaceDirectiveBySpan,
	findSpanForDirective,
	type DirectiveSpan
} from '$lib/rledger/sourceEditor';
import { CASHIER_XACT_FILE } from '$lib/constants';

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

	/** Sort a Beancount source string by directive date, preserving raw source text. */
	private async _sortSource(source: string): Promise<string> {
		if (!source.trim()) return source;
		const tempLedger = createParsedLedger(source);
		if (!tempLedger) return source;
		try {
			const spans = mapDirectiveSpans(source, tempLedger);
			const pairs = spans.map((span) => ({
				date: span.sourceText.slice(0, 10),
				sourceText: span.sourceText
			}));
			pairs.sort((a, b) => a.date.localeCompare(b.date));
			return pairs.map((p) => p.sourceText).join('\n\n') + '\n';
		} finally {
			tempLedger.free();
		}
	}

	/** Append a formatted transaction to cashier.bean → sort by date → invalidate. */
	async appendTransaction(beancountText: string): Promise<void> {
		await ensureInitialized();
		let content = (await opfslib.readFile(CASHIER_XACT_FILE)) ?? '';

		// Ensure a blank-line separator before the new entry.
		if (content.length > 0 && !content.endsWith('\n\n')) {
			content = content.trimEnd() + '\n\n';
		}
		content += beancountText.trimEnd() + '\n';

		content = await this._sortSource(content);
		await opfslib.saveFile(CASHIER_XACT_FILE, content);
		await this.invalidate();
	}

	/**
	 * Edit a transaction in cashier.bean identified by its DirectiveSpan.
	 * Parses cashier.bean independently, locates the span by startLine,
	 * splices in the new text, sorts by date, writes back, and invalidates.
	 */
	async editTransaction(span: DirectiveSpan, newBeancountText: string): Promise<void> {
		await ensureInitialized();
		const source = (await opfslib.readFile(CASHIER_XACT_FILE)) ?? '';
		const tempLedger = createParsedLedger(source);
		if (!tempLedger) throw new Error('Failed to parse cashier.bean');
		try {
			const spans = mapDirectiveSpans(source, tempLedger);
			const idx = spans.findIndex((s) => s.startLine === span.startLine);
			if (idx === -1) {
				throw new Error(
					`Could not locate directive at line ${span.startLine} in ${CASHIER_XACT_FILE}`
				);
			}
			let updated = replaceDirectiveBySpan(source, spans, idx, newBeancountText.trimEnd());
			updated = await this._sortSource(updated);
			await opfslib.saveFile(CASHIER_XACT_FILE, updated);
		} finally {
			tempLedger.free();
		}
		await this.invalidate();
	}

	/**
	 * Delete a transaction from cashier.bean identified by its DirectiveSpan.
	 * Removes the span lines and collapses extra blank lines.
	 */
	async deleteTransaction(span: DirectiveSpan): Promise<void> {
		const source = (await opfslib.readFile(CASHIER_XACT_FILE)) ?? '';
		const tempLedger = createParsedLedger(source);
		if (!tempLedger) throw new Error('Failed to parse cashier.bean');
		try {
			const spans = mapDirectiveSpans(source, tempLedger);
			const idx = spans.findIndex((s) => s.startLine === span.startLine);
			if (idx === -1) {
				throw new Error(
					`Could not locate directive at line ${span.startLine} in ${CASHIER_XACT_FILE}`
				);
			}
			let updated = replaceDirectiveBySpan(source, spans, idx, '');
			// Collapse runs of 3+ blank lines down to 2 (one visual separator).
			updated = updated.replace(/\n{3,}/g, '\n\n');
			await opfslib.saveFile(CASHIER_XACT_FILE, updated);
		} finally {
			tempLedger.free();
		}
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

	/** Read and combine all .bean sources from OPFS: infrastructure files + cashier.bean */
	private async readAndCombineSources(): Promise<string> {
		const parts: string[] = [];

		// Read beancount files (synced from desktop).
		// Read or create cashier.bean (device transactions).
		let cashier = await opfslib.readFile(CASHIER_XACT_FILE);
		if (cashier === undefined) {
			await opfslib.saveFile(CASHIER_XACT_FILE, '');
			cashier = '';
		}
		parts.push(cashier);

		return parts.join('\n\n');
	}

	/**
	 * Read cashier.bean, parse it independently, and return all transaction directives
	 * zipped with their DirectiveSpans (line ranges). Used by the journal page to populate
	 * the list and supply the span needed for editing.
	 */
	async getXactsWithSpans(): Promise<Array<{ xact: Xact; span: DirectiveSpan }>> {
		const source = (await opfslib.readFile(CASHIER_XACT_FILE)) ?? '';
		if (!source.trim()) return [];

		const tempLedger = createParsedLedger(source);
		if (!tempLedger) return [];

		try {
			const directives: any[] = tempLedger.getDirectives();
			const spans = mapDirectiveSpans(source, tempLedger);

			// Match each transaction directive to its source span by date-based lookup.
			// getDirectives() may return directives in chronological order while
			// getDocumentSymbols() (used by mapDirectiveSpans) returns in file order,
			// so we cannot assume a 1:1 index alignment.
			const result: Array<{ xact: Xact; span: DirectiveSpan }> = [];
			for (let i = 0; i < directives.length; i++) {
				const directive = directives[i];
				if (directive.type !== 'transaction') continue;
				const spanIdx = findSpanForDirective(spans, i, source, directives);
				if (spanIdx >= 0) {
					result.push({ xact: this.directiveToXact(directive, source), span: spans[spanIdx] });
				}
			}
			return result;
		} finally {
			tempLedger.free();
		}
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
