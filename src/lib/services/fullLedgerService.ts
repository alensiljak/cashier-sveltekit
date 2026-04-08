/**
 * FullLedgerService — cached Ledger singleton for the full book from the real filesystem.
 *
 * Mirrors the "lite" LedgerService (which wraps a ParsedLedger built from OPFS),
 * but uses the multi-file Ledger class so the entire book is parsed once and
 * subsequent queries reuse the cached instance.
 */

import { writable, derived, type Readable } from 'svelte/store';
import { ensureInitialized, createLedger, ledgerFromCache } from './rustledger';
// import { loadFileMap } from '$lib/sync/sync-fs';
import { listFileTree } from '$lib/utils/opfslib';
import { LedgerFilenames } from '$lib/enums';
import { OPFSBackend } from '$lib/storage';
import type { Ledger, QueryResult, BeancountError, Directive } from '@rustledger/wasm';
import { SettingKeys, settings } from '$lib/settings';

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

		const mainFileName = await settings.get(SettingKeys.bookFilename) as string || LedgerFilenames.book;
		return { fileMap, mainFileName };
	}

	/** Load file map from the filesystem, parse once, cache the Ledger. */
	async load(): Promise<void> {
		await ensureInitialized();
		// const { fileMap, mainFileName, dirHandle } = await loadFileMap();
		// this._dirHandle = dirHandle;
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
}

const fullLedgerService = new FullLedgerService();
export default fullLedgerService;
