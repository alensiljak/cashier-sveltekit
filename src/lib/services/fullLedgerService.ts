/**
 * FullLedgerService — cached Ledger singleton for the full book from the real filesystem.
 *
 * Mirrors the "lite" LedgerService (which wraps a ParsedLedger built from OPFS),
 * but uses the multi-file Ledger class so the entire book is parsed once and
 * subsequent queries reuse the cached instance.
 */

import { writable, derived, type Readable } from 'svelte/store';
import {
	ensureInitialized,
	createLedger,
	ledgerFromCache,
	createParsedLedger,
	format as formatWasm,
	getAccountsFromTransactions,
	version as wasmVersion
} from './rustledger';
import { listFileTree } from '$lib/utils/opfslib';
import { OPFSBackend } from '$lib/storage';
import type { Ledger, QueryResult, BeancountError, Directive, ParsedLedger } from '@rustledger/wasm';
import { SettingKeys, settings } from '$lib/settings';
import { Account, Xact, Posting } from '$lib/data/model';
import * as opfslib from '$lib/utils/opfslib';
import {
	mapDirectiveSpans,
	replaceDirectiveBySpan,
	type DirectiveSpan
} from '$lib/rledger/sourceEditor';
import { CASHIER_XACT_FILE } from '$lib/constants';

class FullLedgerService {
	private ledger: Ledger | null = null;
	private _dirHandle: FileSystemDirectoryHandle | null = null;
	private _version = writable(0);
	readonly version: Readable<number> = derived(this._version, (v) => v);

	/** Load file map from OPFS, reading all *.bean files recursively. */
	async loadOpfsFileMap(): Promise<{ fileMap: Record<string, string>; mainFileName: string }> {
		const opfs = new OPFSBackend();
		const tree = await listFileTree();
		const beanEntries = tree.filter((e) => e.kind === 'file' &&
			e.name.endsWith('.bean'));

		const fileMap: Record<string, string> = {};
		await Promise.all(
			beanEntries.map(async (entry) => {
				const content = await opfs.readFile(entry.path);
				if (content !== undefined) {
					fileMap[entry.path] = content;
				}
			})
		);

		const mainFileName = await settings.get(SettingKeys.bookFilename) as string;
		return { fileMap, mainFileName };
	}

	/** Load file map from the filesystem, parse once, cache the Ledger. */
	async load(): Promise<void> {
		await ensureInitialized();
		const { fileMap, mainFileName } = await this.loadOpfsFileMap();
		this.ledger = createLedger(fileMap, mainFileName);
		this._version.update((v) => v + 1);
	}

	/** The directory handle obtained during the last load. */
	get dirHandle(): FileSystemDirectoryHandle | null {
		return this._dirHandle;
	}

	/** Ensure the ledger is loaded; no-op if already cached. */
	async ensureLoaded(): Promise<void> {
		if (!this.ledger) {
			await this.load();
		}
	}

	/** Ensure WASM is initialized (does not load ledger data). */
	async ensureInitialized(): Promise<void> {
		await ensureInitialized();
	}

	/** Get WASM library version string. */
	getWasmVersion(): string {
		return wasmVersion();
	}

	/** Free the current instance, re-read files, re-parse. */
	async invalidate(): Promise<void> {
		if (this.ledger) {
			this.ledger.free();
			this.ledger = null;
		}
		await this.load();
	}

	/** Run a BQL query against the cached full ledger. */
	query(bql: string): QueryResult {
		if (!this.ledger) throw new Error('Full ledger not loaded');
		return this.ledger.query(bql);
	}

	/** Get parsed directives. */
	getDirectives(): Directive[] {
		if (!this.ledger) return [];
		return this.ledger.getDirectives();
	}

	/** Get all errors (parse + validation). */
	getErrors(): BeancountError[] {
		if (!this.ledger) return [];
		return this.ledger.getErrors();
	}

	/** Get parse errors (alias for getErrors). */
	getParseErrors(): BeancountError[] {
		return this.getErrors();
	}

	/** Get validation errors (alias for getErrors). */
	getValidationErrors(): BeancountError[] {
		return this.getErrors();
	}

	/** Check validity. */
	isValid(): boolean {
		if (!this.ledger) return false;
		return this.ledger.isValid();
	}

	/** Whether the ledger is currently cached. */
	get isLoaded(): boolean {
		return this.ledger !== null;
	}

	/** Free the cached instance. */
	free(): void {
		if (this.ledger) {
			this.ledger.free();
			this.ledger = null;
		}
	}

	/** Serialize the cached ledger to binary bytes. Throws if not loaded. */
	serialize(): Uint8Array {
		if (!this.ledger) throw new Error('Ledger not loaded');
		return this.ledger.serialize();
	}

	/**
	 * Restore the ledger from previously serialized bytes without re-parsing source files.
	 * Caller is responsible for verifying the cache is still valid (e.g. via hash comparison).
	 */
	async loadFromCache(bytes: Uint8Array): Promise<void> {
		await ensureInitialized();
		if (this.ledger) {
			this.ledger.free();
			this.ledger = null;
		}
		this.ledger = ledgerFromCache(bytes);
		this._version.update((v) => v + 1);
	}

	/** Free the instance without reloading — leaves the service in an unloaded state. */
	reset(): void {
		if (this.ledger) {
			this.ledger.free();
			this.ledger = null;
		}
		this._version.update((v) => v + 1);
	}

	/** Stateless: format a Beancount source string. */
	format(source: string): { formatted?: string; errors: BeancountError[] } {
		return formatWasm(source);
	}

	/** Create a new ParsedLedger instance from source (does not affect the cached Ledger). */
	createParsedLedger(source: string): ParsedLedger | null {
		return createParsedLedger(source);
	}

	/** Get accounts with balances from a ParsedLedger instance. */
	getAccountsFromTransactions(ledger: any): Account[] {
		return getAccountsFromTransactions(ledger);
	}

	/** Get all accounts with balances from the cached ledger. */
	getAccounts(): Account[] {
		if (!this.ledger) return [];
		return getAccountsFromTransactions(this.ledger);
	}

	/**
	 * Get all declared accounts from the cached ledger, including those with no transactions.
	 * Merges open-directive accounts with BQL balance results.
	 */
	getAllAccounts(): Account[] {
		if (!this.ledger) return [];

		const directives: any[] = this.ledger.getDirectives();
		const closedAccountNames = new Set<string>(
			directives.filter((d) => d.type === 'close').map((d) => d.account)
		);
		const openAccountNames = new Set<string>(
			directives
				.filter((d) => d.type === 'open' && !closedAccountNames.has(d.account))
				.map((d) => d.account)
		);

		const txAccounts = getAccountsFromTransactions(this.ledger);
		const txAccountMap = new Map<string, Account>(txAccounts.map((a) => [a.name, a]));

		const all = new Map<string, Account>();
		for (const name of openAccountNames) {
			all.set(name, txAccountMap.get(name) ?? new Account(name));
		}
		for (const account of txAccounts) {
			if (!all.has(account.name) && !closedAccountNames.has(account.name)) {
				all.set(account.name, account);
			}
		}

		return Array.from(all.values()).sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Get all transactions from the cached ledger as Xact objects. */
	getXacts(): Xact[] {
		if (!this.ledger) return [];
		const directives: any[] = this.ledger.getDirectives();
		return directives.filter((d) => d.type === 'transaction').map((d) => this.directiveToXact(d));
	}

	/**
	 * Read cashier.bean, parse it independently, and return all transaction directives
	 * zipped with their DirectiveSpans (line ranges). Used by the journal page.
	 */
	async getXactsWithSpans(): Promise<Array<{ xact: Xact; span: DirectiveSpan }>> {
		const source = (await opfslib.readFile(CASHIER_XACT_FILE)) ?? '';
		if (!source.trim()) return [];

		const tempLedger = createParsedLedger(source);
		if (!tempLedger) return [];

		try {
			const directives: any[] = tempLedger.getDirectives();
			const spans = mapDirectiveSpans(source, tempLedger);

			return directives
				.filter((d) => d.type === 'transaction')
				.map((directive, i) => ({
					xact: this.directiveToXact(directive),
					span: spans[i]
				}));
		} finally {
			tempLedger.free();
		}
	}

	/** Append a formatted transaction to cashier.bean and invalidate. */
	async appendTransaction(beancountText: string): Promise<void> {
		let content = (await opfslib.readFile(CASHIER_XACT_FILE)) ?? '';

		if (content.length > 0 && !content.endsWith('\n\n')) {
			content = content.trimEnd() + '\n\n';
		}
		content += beancountText.trimEnd() + '\n';

		await opfslib.saveFile(CASHIER_XACT_FILE, content);
		await this.invalidate();
	}

	/**
	 * Edit a transaction in cashier.bean identified by its DirectiveSpan.
	 * Parses cashier.bean independently, locates the span, splices in new text, and invalidates.
	 */
	async editTransaction(span: DirectiveSpan, newBeancountText: string): Promise<void> {
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
			const updated = replaceDirectiveBySpan(source, spans, idx, newBeancountText.trimEnd());
			await opfslib.saveFile(CASHIER_XACT_FILE, updated);
		} finally {
			tempLedger.free();
		}
		await this.invalidate();
	}

	/**
	 * Delete a transaction from cashier.bean identified by its DirectiveSpan.
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
			updated = updated.replace(/\n{3,}/g, '\n\n');
			await opfslib.saveFile(CASHIER_XACT_FILE, updated);
		} finally {
			tempLedger.free();
		}
		await this.invalidate();
	}

	/** Convert a WASM TransactionDirective to an Xact view model. */
	private directiveToXact(directive: any): Xact {
		const tx = new Xact();
		tx.date = directive.date;
		tx.payee = directive.payee ?? '';
		tx.note = directive.narration ?? '';
		tx.postings = (directive.postings ?? []).map((p: any) => {
			const posting = new Posting();
			posting.account = p.account ?? '';
			if (p.units?.number != null) posting.amount = parseFloat(p.units.number);
			if (p.units?.currency) posting.currency = p.units.currency;
			return posting;
		});
		return tx;
	}
}

const fullLedgerService = new FullLedgerService();
export default fullLedgerService;
