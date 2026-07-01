/**
 * Vitest global setup — runs once per test file before its imports execute
 * side effects.
 *
 * Three browser/library things the codebase relies on at module-load time
 * don't exist (or don't perform) in Vitest's Node/jsdom environment, so we
 * stub them here rather than special-casing test mode in production code:
 *
 * 1. `Worker` — LedgerWorkerClient spawns a real Worker in its constructor.
 *    Tests that only need the class to exist (not actually run the worker)
 *    get a no-op stub.
 * 2. WASM asset fetch — `@rustledger/wasm` inits via `fetch(wasmUrl)`. Vite's
 *    `?url` import resolves to an absolute filesystem-style path that isn't a
 *    valid URL for Node's fetch. We intercept `.wasm` requests and serve the
 *    real bytes from disk so WASM-dependent tests exercise the actual parser
 *    instead of being skipped or mocked away.
 * 3. `@lucide/svelte` — the package barrel re-exports ~1700 individual icon
 *    components; per lucide-icons/lucide#2806, importing even one icon from
 *    the barrel forces evaluation of all of them, both in dev (10x reload
 *    slowdown) and under Vitest (30s+ per import, well past any test
 *    timeout). Every icon is mocked to the same trivial stub component —
 *    tests assert on behavior/markup structure, never on which icon glyph
 *    rendered.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { vi } from 'vitest';
import IconStub from './mocks/IconStub.svelte';

vi.mock('@lucide/svelte', () => {
	// Only intercept plain string icon-name lookups. `then` in particular
	// must fall through to `undefined` — otherwise native code awaiting this
	// module namespace treats it as a thenable and invokes IconStub as an
	// executor function instead of rendering it as a component.
	return new Proxy(
		{},
		{
			get: (_target, prop) => (typeof prop === 'string' && prop !== 'then' ? IconStub : undefined),
			// Vitest's ESM interop checks named-import bindings exist via `in`
			// before reading them — without this, every named icon import
			// throws "No export is defined on the mock" despite `get` above.
			has: (_target, prop) => typeof prop === 'string' && prop !== 'then'
		}
	);
});

class NoopWorker {
	onmessage: ((e: MessageEvent) => void) | null = null;
	onerror: ((e: ErrorEvent) => void) | null = null;
	postMessage(): void {}
	terminate(): void {}
	addEventListener(): void {}
	removeEventListener(): void {}
}

if (typeof globalThis.Worker === 'undefined') {
	// @ts-expect-error - test stub, not a full Worker implementation
	globalThis.Worker = NoopWorker;
}

const realFetch = globalThis.fetch?.bind(globalThis);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = typeof input === 'string' ? input : input.toString();
	if (url.endsWith('.wasm')) {
		// Vite's `?url` import gives us a path like
		// "/node_modules/@rustledger/wasm/rustledger_wasm_bg.wasm" — resolve it
		// against the project root and read the real binary from disk.
		const relative = url.replace(/^\/+/, '').replace(/^@fs\//, '');
		const absolute = path.isAbsolute(relative) ? relative : path.join(process.cwd(), relative);
		const bytes = await readFile(absolute);
		return new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } });
	}
	if (!realFetch) throw new Error(`fetch() unavailable in test env for: ${url}`);
	return realFetch(input, init);
}) as typeof fetch;

vi.stubGlobal('fetch', globalThis.fetch);
