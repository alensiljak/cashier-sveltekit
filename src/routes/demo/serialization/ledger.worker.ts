/**
 * Ledger serialization Web Worker.
 * Handles serialize and deserialize operations off the main thread.
 * OPFS is accessible from workers; WASM is initialized here independently.
 */

import wasmUrl from '@rustledger/wasm/rustledger_wasm_bg.wasm?url';

const CACHE_FILE = 'ledger-cache.bin';

let wasmModule: typeof import('@rustledger/wasm') | null = null;

async function initWasm() {
	if (wasmModule) return;
	const mod = await import('@rustledger/wasm');
	await mod.default({ module_or_path: wasmUrl });
	wasmModule = mod;
}

// --- OPFS helpers (no SvelteKit imports allowed in workers) ---

async function opfsGetHandle(filename: string, create = false): Promise<FileSystemFileHandle | undefined> {
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

// --- Message handlers ---

export type WorkerRequest =
	| { type: 'serialize'; mainFileName: string }
	| { type: 'deserialize' };

export type WorkerResponse =
	| { type: 'serialize-done'; bytes: number; ms: number }
	| { type: 'deserialize-done'; directives: number; bytes: number; ms: number }
	| { type: 'error'; message: string };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
	try {
		await initWasm();
		const wasm = wasmModule!;

		if (e.data.type === 'serialize') {
			const t0 = performance.now();

			const beanFiles = await opfsListBeanFiles();
			if (beanFiles.length === 0) throw new Error('No .bean files found in OPFS');

			const fileMap: Record<string, string> = {};
			for (const { path, content } of beanFiles) {
				fileMap[path] = content;
			}

			const ledger = wasm.Ledger.fromFiles(fileMap, e.data.mainFileName);
			const bytes = ledger.serialize();
			ledger.free();

			await opfsSaveBinary(CACHE_FILE, bytes);

			const ms = performance.now() - t0;
			const resp: WorkerResponse = { type: 'serialize-done', bytes: bytes.length, ms };
			self.postMessage(resp);

		} else if (e.data.type === 'deserialize') {
			const t0 = performance.now();

			const bytes = await opfsReadBinary(CACHE_FILE);
			if (!bytes) throw new Error('No cache file found in OPFS. Serialize first.');

			const ledger = wasm.Ledger.fromCache(bytes);
			const directives = ledger.getDirectives().length;
			ledger.free();

			const ms = performance.now() - t0;
			const resp: WorkerResponse = { type: 'deserialize-done', directives, bytes: bytes.length, ms };
			self.postMessage(resp);
		}
	} catch (err) {
		const resp: WorkerResponse = { type: 'error', message: String(err) };
		self.postMessage(resp);
	}
};
