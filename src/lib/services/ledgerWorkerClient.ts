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

import { writable, derived, type Readable } from 'svelte/store';
import { settings, SettingKeys } from '$lib/settings';
import { LedgerFilenames } from '$lib/enums';
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
	private _version = writable(0);
	readonly version: Readable<number> = derived(this._version, (v) => v);

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
		return (await settings.get<string>(SettingKeys.bookFilename)) ?? LedgerFilenames.book;
	}

	// -------------------------------------------------------------------------
	// Public API  (mirrors FullLedgerService, query/getDirectives/getErrors async)
	// -------------------------------------------------------------------------

	get isLoaded(): boolean {
		return this._isLoaded;
	}

	/** Parse all .bean files from OPFS, replace the cached ledger. */
	async load(): Promise<void> {
		await this.send<'load-done'>({ type: 'load', mainFileName: await this.mainFileName() });
		this._isLoaded = true;
		this._version.update((v) => v + 1);
	}

	/** Load only if not already loaded; no-op otherwise. */
	async ensureLoaded(): Promise<void> {
		if (this._isLoaded) return;
		await this.load();
	}

	/** Free and re-parse — picks up source file changes. */
	async invalidate(): Promise<void> {
		await this.send<'load-done'>({ type: 'invalidate', mainFileName: await this.mainFileName() });
		this._isLoaded = true;
		this._version.update((v) => v + 1);
	}

	/** Run a BQL query against the cached ledger. */
	async query(bql: string): Promise<{ columns: string[]; rows: unknown[]; errors: unknown[] }> {
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
		this._isLoaded = true;
		this._version.update((v) => v + 1);
		return { directiveCount: resp.directiveCount, ms: resp.ms };
	}

	/** Return all open accounts (from #accounts where close is null). */
	async getAllAccounts(): Promise<Array<{ name: string; currencies: string[] }>> {
		const resp = await this.send<'all-accounts-done'>({ type: 'get-all-accounts' });
		return resp.accounts;
	}

	/** Free the cached ledger without reloading. */
	async reset(): Promise<void> {
		await this.send<'reset-done'>({ type: 'reset' });
		this._isLoaded = false;
		this._version.update((v) => v + 1);
	}

	/**
	 * Free the in-memory ledger and delete the OPFS binary cache.
	 * Call this whenever source files change so the next ensureLoaded()
	 * re-parses fresh data instead of serving a stale cache.
	 */
	async deleteCache(): Promise<void> {
		await this.send<'delete-cache-done'>({ type: 'delete-cache' });
		this._isLoaded = false;
		this._version.update((v) => v + 1);
	}
}

const fullLedgerService = new LedgerWorkerClient();
export default fullLedgerService;
