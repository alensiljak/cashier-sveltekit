/**
 * Ledger Web Worker.
 *
 * Owns a persistent Ledger WASM instance across messages so that file I/O and
 * CPU-intensive parsing/querying never block the main thread.
 *
 * No SvelteKit / $lib imports — only bare npm packages and relative paths.
 */

import wasmUrl from '@rustledger/wasm/rustledger_wasm_bg.wasm?url';
import { LEDGER_CACHE_FILE } from '../constants';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let wasmModule: typeof import('@rustledger/wasm') | null = null;
let ledger: import('@rustledger/wasm').Ledger | null = null;

// ---------------------------------------------------------------------------
// WASM init
// ---------------------------------------------------------------------------

async function initWasm() {
	if (wasmModule) return;
	const mod = await import('@rustledger/wasm');
	await mod.default({ module_or_path: wasmUrl });
	wasmModule = mod;
}

// ---------------------------------------------------------------------------
// OPFS helpers
// ---------------------------------------------------------------------------

async function opfsGetHandle(
	filename: string,
	create = false
): Promise<FileSystemFileHandle | undefined> {
	try {
		const root = await navigator.storage.getDirectory();
		const parts = filename.split('/');
		const name = parts.pop()!;
		let dir: FileSystemDirectoryHandle = root;
		for (const part of parts) {
			dir = await dir.getDirectoryHandle(part, { create });
		}
		return await dir.getFileHandle(name, { create });
	} catch {
		return undefined;
	}
}

async function opfsReadBinary(filename: string): Promise<Uint8Array | undefined> {
	const handle = await opfsGetHandle(filename);
	if (!handle) return undefined;
	const file = await handle.getFile();
	return new Uint8Array(await file.arrayBuffer());
}

async function opfsSaveBinary(filename: string, data: Uint8Array): Promise<void> {
	const handle = await opfsGetHandle(filename, true);
	if (!handle) throw new Error(`Cannot open ${filename} for writing`);
	const stream = await handle.createWritable();
	await stream.write(data.buffer as ArrayBuffer);
	await stream.close();
}

async function opfsDeleteFile(filename: string): Promise<void> {
	try {
		const root = await navigator.storage.getDirectory();
		const parts = filename.split('/');
		const name = parts.pop()!;
		let dir: FileSystemDirectoryHandle = root;
		for (const part of parts) {
			dir = await dir.getDirectoryHandle(part);
		}
		await dir.removeEntry(name);
	} catch {
		// File doesn't exist — that's fine
	}
}

async function opfsListBeanFiles(): Promise<Array<{ path: string; content: string }>> {
	const root = await navigator.storage.getDirectory();
	const results: Array<{ path: string; content: string }> = [];

	async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		for await (const [name, handle] of (dir as any).entries()) {
			const path = prefix ? `${prefix}/${name}` : name;
			if (handle.kind === 'directory') {
				await walk(handle as FileSystemDirectoryHandle, path);
			} else if (name.endsWith('.bean')) {
				const file = await (handle as FileSystemFileHandle).getFile();
				results.push({ path, content: await file.text() });
			}
		}
	}

	await walk(root, '');
	return results;
}

async function loadFromCacheOrFiles(
	mainFileName: string,
	userBookFilename?: string
): Promise<void> {
	const bytes = await opfsReadBinary(LEDGER_CACHE_FILE);
	if (bytes) {
		try {
			if (ledger) {
				ledger.free();
				ledger = null;
			}
			ledger = wasmModule!.Ledger.fromCache(bytes);
			return;
		} catch {
			// Cache corrupt or version mismatch — fall through to file parse
		}
	}
	await loadFromFiles(mainFileName, userBookFilename);
}

// ---------------------------------------------------------------------------
// Message protocol
// ---------------------------------------------------------------------------

/**
 * All requests include an `id` that is echoed in the matching response so the
 * client can resolve the correct promise.
 */
export type WorkerRequestPayload =
	// --- Persistent-ledger operations ---
	| { type: 'load'; mainFileName: string; userBookFilename?: string }
	| { type: 'ensure-loaded'; mainFileName: string; userBookFilename?: string }
	| { type: 'invalidate'; mainFileName: string; userBookFilename?: string }
	| { type: 'query'; bql: string }
	| { type: 'get-directives' }
	| { type: 'get-errors' }
	| { type: 'get-state' }
	| { type: 'reset' }
	/** Serialize the persistent ledger to the OPFS cache file. */
	| { type: 'serialize-ledger' }
	/** Restore the persistent ledger from the OPFS cache file. */
	| { type: 'load-from-cache' }
	/** Free the in-memory ledger and delete the OPFS cache file. */
	| { type: 'delete-cache' }
	/** Return all open accounts (open directives + BQL tx accounts merged). */
	| { type: 'get-all-accounts' }
	/** Return ledger options (e.g. operating_currencies). */
	| { type: 'get-options' };

export type WorkerRequest = { id: number } & WorkerRequestPayload;

export type WorkerResponsePayload =
	| { type: 'load-done'; directiveCount: number; errorCount: number; ms: number }
	| { type: 'query-done'; columns: string[]; rows: unknown[]; errors: unknown[] }
	| { type: 'directives-done'; directives: unknown[] }
	| { type: 'errors-done'; errors: unknown[] }
	| { type: 'state-done'; isLoaded: boolean }
	| { type: 'reset-done' }
	| { type: 'all-accounts-done'; accounts: Array<{ name: string; currencies: string[] }> }
	| { type: 'serialize-ledger-done'; bytes: number; ms: number }
	| { type: 'load-from-cache-done'; directiveCount: number; ms: number }
	| { type: 'delete-cache-done' }
	| { type: 'options-done'; operatingCurrencies: string[] }
	| { type: 'error'; message: string };

export type WorkerResponse = { id: number } & WorkerResponsePayload;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadFromFiles(mainFileName: string, userBookFilename?: string): Promise<void> {
	const wasm = wasmModule!;
	if (ledger) {
		ledger.free();
		ledger = null;
	}
	const beanFiles = await opfsListBeanFiles();
	if (beanFiles.length === 0) throw new Error('No .bean files found in OPFS');
	const fileMap: Record<string, string> = {};
	for (const { path, content } of beanFiles) {
		fileMap[path] = content;
	}
	// Inject the user's book include into cashier.bean on-the-fly, without
	// persisting the directive to disk. Only when the book file is actually present.
	if (
		userBookFilename &&
		userBookFilename !== mainFileName &&
		fileMap[mainFileName] !== undefined &&
		fileMap[userBookFilename] !== undefined
	) {
		fileMap[mainFileName] = `include "${userBookFilename}"\n\n${fileMap[mainFileName]}`;
	}
	ledger = wasm.Ledger.fromFiles(fileMap, mainFileName);
}

// ---------------------------------------------------------------------------
// Message handler — serialized via a queue so async handlers never interleave.
// An async onmessage can be re-entered while awaiting; the queue ensures that
// e.g. a 'query' message never races a concurrent 'invalidate'.
// ---------------------------------------------------------------------------

const _msgQueue: MessageEvent<WorkerRequest>[] = [];
let _processing = false;

async function handleMessage(e: MessageEvent<WorkerRequest>): Promise<void> {
	const { id } = e.data;

	const reply = (data: WorkerResponsePayload) => {
		(self as unknown as Worker).postMessage({ id, ...data } satisfies WorkerResponse);
	};

	try {
		await initWasm();

		switch (e.data.type) {
			case 'load': {
				const t0 = performance.now();
				await loadFromFiles(e.data.mainFileName, e.data.userBookFilename);
				const ms = performance.now() - t0;
				reply({
					type: 'load-done',
					directiveCount: ledger!.getDirectives().length,
					errorCount: ledger!.getErrors().length,
					ms
				});
				break;
			}

			case 'ensure-loaded': {
				if (!ledger) {
					const t0 = performance.now();
					await loadFromCacheOrFiles(e.data.mainFileName, e.data.userBookFilename);
					const ms = performance.now() - t0;
					reply({
						type: 'load-done',
						directiveCount: ledger!.getDirectives().length,
						errorCount: ledger!.getErrors().length,
						ms
					});
				} else {
					reply({
						type: 'load-done',
						directiveCount: ledger.getDirectives().length,
						errorCount: ledger.getErrors().length,
						ms: 0
					});
				}
				break;
			}

			case 'invalidate': {
				const t0 = performance.now();
				await loadFromFiles(e.data.mainFileName, e.data.userBookFilename);
				// Update the cache so future ensure-loaded calls get fresh data
				try {
					await opfsSaveBinary(LEDGER_CACHE_FILE, ledger!.serialize());
				} catch {
					// Non-fatal — cache update failed but ledger is in memory
				}
				const ms = performance.now() - t0;
				reply({
					type: 'load-done',
					directiveCount: ledger!.getDirectives().length,
					errorCount: ledger!.getErrors().length,
					ms
				});
				break;
			}

			case 'query': {
				if (!ledger) throw new Error('Ledger not loaded');
				const result = ledger.query(e.data.bql);
				reply({
					type: 'query-done',
					columns: result.columns ?? [],
					rows: result.rows ?? [],
					errors: result.errors ?? []
				});
				break;
			}

			case 'get-directives': {
				reply({
					type: 'directives-done',
					directives: ledger ? ledger.getDirectives() : []
				});
				break;
			}

			case 'get-errors': {
				reply({
					type: 'errors-done',
					errors: ledger ? ledger.getErrors() : []
				});
				break;
			}

			case 'get-state': {
				reply({ type: 'state-done', isLoaded: ledger !== null });
				break;
			}

			case 'reset': {
				if (ledger) {
					ledger.free();
					ledger = null;
				}
				reply({ type: 'reset-done' });
				break;
			}

			case 'serialize-ledger': {
				if (!ledger) throw new Error('Ledger not loaded — call load or ensure-loaded first');
				const t0 = performance.now();
				const bytes = ledger.serialize();
				await opfsSaveBinary(LEDGER_CACHE_FILE, bytes);
				const ms = performance.now() - t0;
				// Transfer the buffer zero-copy; the worker no longer needs it
				reply({ type: 'serialize-ledger-done', bytes: bytes.length, ms });
				break;
			}

			case 'load-from-cache': {
				const t0 = performance.now();
				const bytes = await opfsReadBinary(LEDGER_CACHE_FILE);
				if (!bytes) throw new Error('No cache file found in OPFS. Serialize first.');
				if (ledger) {
					ledger.free();
					ledger = null;
				}
				ledger = wasmModule!.Ledger.fromCache(bytes);
				const ms = performance.now() - t0;
				reply({
					type: 'load-from-cache-done',
					directiveCount: ledger.getDirectives().length,
					ms
				});
				break;
			}

			case 'delete-cache': {
				if (ledger) {
					ledger.free();
					ledger = null;
				}
				await opfsDeleteFile(LEDGER_CACHE_FILE);
				reply({ type: 'delete-cache-done' });
				break;
			}

			case 'get-all-accounts': {
				if (!ledger) {
					reply({ type: 'all-accounts-done', accounts: [] });
					break;
				}
				const bql =
					'SELECT account, currencies from #accounts where close is null ORDER BY account';
				const result = ledger.query(bql);
				const accountCol = (result.columns ?? []).indexOf('account');
				const currenciesCol = (result.columns ?? []).indexOf('currencies');
				const accounts = ((result.rows ?? []) as any[]).map((row) => ({
					name: accountCol !== -1 ? (row[accountCol] ?? '') : '',
					currencies: currenciesCol !== -1 ? (row[currenciesCol] ?? []) : []
				}));
				reply({ type: 'all-accounts-done', accounts });
				break;
			}

			case 'get-options': {
				const opts = ledger ? ledger.getOptions() : null;
				reply({
					type: 'options-done',
					operatingCurrencies: opts?.operating_currencies ?? []
				});
				break;
			}

			default:
				reply({
					type: 'error',
					message: `Unknown request type: ${(e.data as WorkerRequest).type}`
				});
		}
	} catch (err) {
		reply({ type: 'error', message: String(err) });
	}
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
	_msgQueue.push(e);
	if (!_processing) {
		_processing = true;
		(async () => {
			while (_msgQueue.length > 0) {
				await handleMessage(_msgQueue.shift()!);
			}
			_processing = false;
		})();
	}
};
