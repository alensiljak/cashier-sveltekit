/**
 * LedgerWorkerClient — drop-in async replacement for FullLedgerService.
 *
 * Delegates all WASM and OPFS work to ledger.worker.ts so the main thread
 * stays free.  Methods that were synchronous in the old service are now async
 * because the worker responds asynchronously.
 *
 * The singleton exported at the bottom is named `fullLedgerService` so that
 * callers only need to update the import path, not the variable name.
 */

import { writable, derived, get, type Readable } from 'svelte/store';
import { settings, SettingKeys } from '$lib/settings';
import type {
	WorkerRequestPayload,
	WorkerResponse,
	WorkerResponsePayload
} from '$lib/workers/ledger.worker';

// Extract the response shape for a given `type` discriminant.
type ResponseOf<T extends WorkerResponsePayload['type']> = Extract<WorkerResponsePayload, { type: T }>;

class LedgerWorkerClient {
	private _worker: Worker | null = null;
	private _pending = new Map<
		number,
		{ resolve: (v: WorkerResponsePayload) => void; reject: (e: Error) => void }
	>();
	private _nextId = 0;

	private _isLoaded = false;
	private _loaded = writable(false);
	private _isConfigured = writable(false);
	private _version = writable(0);
	private _isReloading = writable(false);
	readonly loaded: Readable<boolean> = derived(this._loaded, (value) => value);
	readonly version: Readable<number> = derived(this._version, (v) => v);
	/** False until at least one successful load with .bean files present. */
	readonly isConfigured: Readable<boolean> = derived(this._isConfigured, (v) => v);
	/** True while a background invalidate/re-parse is in progress. */
	readonly isReloading: Readable<boolean> = derived(this._isReloading, (v) => v);

	// -------------------------------------------------------------------------
	// Worker lifecycle
	// -------------------------------------------------------------------------

	private get worker(): Worker {
		if (!this._worker) {
			this._worker = new Worker(
				new URL('$lib/workers/ledger.worker.ts', import.meta.url),
				{ type: 'module' }
			);
			this._worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
				const { id, ...payload } = e.data;
				const pending = this._pending.get(id);
				if (!pending) return;
				this._pending.delete(id);
				if (payload.type === 'error') {
					pending.reject(new Error((payload as { type: 'error'; message: string }).message));
				} else {
					pending.resolve(payload as WorkerResponsePayload);
				}
			};
			this._worker.onerror = (e) => {
				const err = new Error(e.message ?? 'Ledger worker crashed');
				for (const p of this._pending.values()) p.reject(err);
				this._pending.clear();
				this._worker = null;
			};
		}
		return this._worker;
	}

	// -------------------------------------------------------------------------
	// Internal: post a typed request, await the matching response
	// -------------------------------------------------------------------------

	private send<T extends WorkerResponsePayload['type']>(
		payload: WorkerRequestPayload
	): Promise<ResponseOf<T>> {
		const id = this._nextId++;
		return new Promise((resolve, reject) => {
			this._pending.set(id, {
				resolve: (v) => resolve(v as ResponseOf<T>),
				reject
			});
			// Manually merge id so TypeScript doesn't need to understand Omit<union>
			this.worker.postMessage(Object.assign({ id }, payload));
		});
	}

	// -------------------------------------------------------------------------
	// Settings helper
	// -------------------------------------------------------------------------

	private async mainFileName(): Promise<string> {
		return (await settings.get<string>(SettingKeys.bookFilename)) ?? 'book.bean';
	}

	// -------------------------------------------------------------------------
	// Public API  (mirrors FullLedgerService, query/getDirectives/getErrors async)
	// -------------------------------------------------------------------------

	private setLoaded(value: boolean): void {
		this._isLoaded = value;
		this._loaded.set(value);
	}

	get isLoaded(): boolean {
		return this._isLoaded;
	}

	/** Parse all .bean files from OPFS, replace the cached ledger. */
	async load(): Promise<void> {
		try {
			await this.send<'load-done'>({ type: 'load', mainFileName: await this.mainFileName() });
			this.setLoaded(true);
			this._isConfigured.set(true);
			this._version.update((v) => v + 1);
		} catch (err) {
			if (String(err).includes('No .bean files found')) {
				// App not yet configured — stay unloaded but don't crash callers.
				this.setLoaded(false);
				this._isConfigured.set(false);
				return;
			}
			this.setLoaded(false);
			throw err;
		}
	}

	/** Load only if not already loaded; no-op otherwise.
	 *  Also skips if an invalidate() is already in progress — the version bump
	 *  at the end of invalidation will retrigger any reactive subscribers. */
	async ensureLoaded(): Promise<void> {
		if (this._isLoaded) return;
		if (get(this._isReloading)) return;
		await this.load();
	}

	/** Free and re-parse — picks up source file changes. */
	async invalidate(): Promise<void> {
		this._isReloading.set(true);
		this.setLoaded(false); // prevent queries from reaching the worker while re-parsing
		try {
			await this.send<'load-done'>({ type: 'invalidate', mainFileName: await this.mainFileName() });
			this.setLoaded(true);
			this._version.update((v) => v + 1);
		} finally {
			this._isReloading.set(false);
		}
	}

	/** Run a BQL query against the cached ledger. Returns empty results if not loaded. */
	async query(bql: string): Promise<{ columns: string[]; rows: unknown[]; errors: unknown[] }> {
		if (!this._isLoaded) return { columns: [], rows: [], errors: [] };
		const resp = await this.send<'query-done'>({ type: 'query', bql });
		return { columns: resp.columns, rows: resp.rows, errors: resp.errors };
	}

	/** Return all parsed directives. */
	async getDirectives(): Promise<unknown[]> {
		const resp = await this.send<'directives-done'>({ type: 'get-directives' });
		return resp.directives;
	}

	/** Return all parse / validation errors. */
	async getErrors(): Promise<unknown[]> {
		const resp = await this.send<'errors-done'>({ type: 'get-errors' });
		return resp.errors;
	}

	/**
	 * Serialize the loaded ledger to the OPFS binary cache.
	 * Returns byte count and elapsed milliseconds.
	 */
	async serialize(): Promise<{ bytes: number; ms: number }> {
		const resp = await this.send<'serialize-ledger-done'>({ type: 'serialize-ledger' });
		return { bytes: resp.bytes, ms: resp.ms };
	}

	/**
	 * Restore the ledger from the OPFS binary cache written by serialize().
	 * Returns directive count and elapsed milliseconds.
	 */
	async loadFromCache(): Promise<{ directiveCount: number; ms: number }> {
		const resp = await this.send<'load-from-cache-done'>({ type: 'load-from-cache' });
		this.setLoaded(true);
		this._version.update((v) => v + 1);
		return { directiveCount: resp.directiveCount, ms: resp.ms };
	}

	/** Return all open accounts (from #accounts where close is null). */
	async getAllAccounts(): Promise<Array<{ name: string; currencies: string[] }>> {
		const resp = await this.send<'all-accounts-done'>({ type: 'get-all-accounts' });
		return resp.accounts;
	}

	/** Return the operating currencies declared in the ledger options. */
	async getOperatingCurrencies(): Promise<string[]> {
		const resp = await this.send<'options-done'>({ type: 'get-options' });
		return resp.operatingCurrencies;
	}

	/** Free the cached ledger without reloading. */
	async reset(): Promise<void> {
		await this.send<'reset-done'>({ type: 'reset' });
		this.setLoaded(false);
		this._version.update((v) => v + 1);
	}

	/**
	 * Free the in-memory ledger and delete the OPFS binary cache.
	 * Call this whenever source files change so the next ensureLoaded()
	 * re-parses fresh data instead of serving a stale cache.
	 */
	async deleteCache(): Promise<void> {
		await this.send<'delete-cache-done'>({ type: 'delete-cache' });
		this.setLoaded(false);
		this._version.update((v) => v + 1);
	}
}

const fullLedgerService = new LedgerWorkerClient();
export default fullLedgerService;
