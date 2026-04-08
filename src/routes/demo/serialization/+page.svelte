<script lang="ts">
	import { onMount } from 'svelte';
	import fullLedgerService from '$lib/services/fullLedgerService';
	import { computeSourceHash } from '$lib/services/rustledger';
	import { settings, SettingKeys } from '$lib/settings';
	import { saveBinaryFile, readBinaryFile, getFileMetadata } from '$lib/utils/opfslib';
	import type { WorkerRequest, WorkerResponse } from './ledger.worker';

	const CACHE_FILE = 'ledger-cache.bin';

	let status = '';
	let isLoaded = false;
	let cacheSize: number | null = null;
	let storedHash = '';
	let currentHash = '';
	let directiveCount = 0;
	let isWorking = false;
	let isWorkerWorking = false;

	// Timing state
	let serializeMs: number | null = null;
	let deserializeMs: number | null = null;
	let workerSerializeMs: number | null = null;
	let workerDeserializeMs: number | null = null;

	let worker: Worker | null = null;

	onMount(async () => {
		await refreshStatus();
		worker = new Worker(new URL('./ledger.worker.ts', import.meta.url), { type: 'module' });
	});

	async function refreshStatus() {
		isLoaded = fullLedgerService.isLoaded;
		directiveCount = fullLedgerService.getDirectives().length;

		const meta = await getFileMetadata(CACHE_FILE);
		cacheSize = meta?.size ?? null;

		storedHash = (await settings.get<string>(SettingKeys.ledgerCacheHash)) ?? '';
	}

	async function handleSerialize() {
		isWorking = true;
		serializeMs = null;
		status = 'Loading ledger...';
		try {
			await fullLedgerService.ensureLoaded();

			status = 'Serializing...';
			const t0 = performance.now();
			const bytes = fullLedgerService.serialize();
			await saveBinaryFile(CACHE_FILE, bytes);
			serializeMs = performance.now() - t0;

			// Compute hash from source files and persist it
			const { fileMap } = await fullLedgerService.loadOpfsFileMap();
			currentHash = hashFileMap(fileMap);
			await settings.set(SettingKeys.ledgerCacheHash, currentHash);

			status = `Serialized ${bytes.length.toLocaleString()} bytes → OPFS. Hash saved.`;
			await refreshStatus();
		} catch (e) {
			status = `Error: ${e}`;
		} finally {
			isWorking = false;
		}
	}

	async function handleDeserialize() {
		isWorking = true;
		deserializeMs = null;
		status = 'Reading cache from OPFS...';
		try {
			// Time OPFS read + WASM fromCache — same scope as worker
			const t0 = performance.now();
			const bytes = await readBinaryFile(CACHE_FILE);
			if (!bytes) {
				status = 'No cache file found in OPFS. Serialize first.';
				return;
			}
			await fullLedgerService.loadFromCache(bytes);
			deserializeMs = performance.now() - t0;

			// Hash comparison happens after timing (reads all .bean files — would skew numbers)
			const { fileMap } = await fullLedgerService.loadOpfsFileMap();
			currentHash = hashFileMap(fileMap);
			const hashMatch = storedHash && currentHash === storedHash;

			const directives = fullLedgerService.getDirectives().length;
			status = `Restored from cache (${bytes.length.toLocaleString()} bytes, ${directives} directives). Hash ${hashMatch ? 'matches ✓' : 'mismatch — sources may have changed'}.`;
			await refreshStatus();
		} catch (e) {
			status = `Error: ${e}`;
		} finally {
			isWorking = false;
		}
	}

	async function handleWorkerSerialize() {
		if (!worker) return;
		isWorkerWorking = true;
		workerSerializeMs = null;
		status = 'Worker: serializing...';

		const { mainFileName } = await fullLedgerService.loadOpfsFileMap();

		worker.onmessage = async (e: MessageEvent<WorkerResponse>) => {
			if (e.data.type === 'serialize-done') {
				workerSerializeMs = e.data.ms;
				status = `Worker serialized ${e.data.bytes.toLocaleString()} bytes → OPFS in ${fmt(e.data.ms)}.`;
				await refreshStatus();
			} else if (e.data.type === 'error') {
				status = `Worker error: ${e.data.message}`;
			}
			isWorkerWorking = false;
		};

		const req: WorkerRequest = { type: 'serialize', mainFileName };
		worker.postMessage(req);
	}

	async function handleWorkerDeserialize() {
		if (!worker) return;
		isWorkerWorking = true;
		workerDeserializeMs = null;
		status = 'Worker: deserializing...';

		worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
			if (e.data.type === 'deserialize-done') {
				workerDeserializeMs = e.data.ms;
				status = `Worker restored from cache (${e.data.bytes.toLocaleString()} bytes, ${e.data.directives} directives) in ${fmt(e.data.ms)}.`;
			} else if (e.data.type === 'error') {
				status = `Worker error: ${e.data.message}`;
			}
			isWorkerWorking = false;
		};

		const req: WorkerRequest = { type: 'deserialize' };
		worker.postMessage(req);
	}

	async function handleCalculateHash() {
		isWorking = true;
		status = 'Reading OPFS files...';
		try {
			const { fileMap } = await fullLedgerService.loadOpfsFileMap();
			currentHash = hashFileMap(fileMap);
			status = `Hash calculated from ${Object.keys(fileMap).length} source file(s).`;
		} catch (e) {
			status = `Error: ${e}`;
		} finally {
			isWorking = false;
		}
	}

	async function handleReset() {
		fullLedgerService.reset();
		currentHash = '';
		serializeMs = null;
		deserializeMs = null;
		workerSerializeMs = null;
		workerDeserializeMs = null;
		status = 'Ledger instance freed (not loaded).';
		await refreshStatus();
	}

	function hashFileMap(fileMap: Record<string, string>): string {
		const sources = Object.keys(fileMap).sort().map((k) => fileMap[k]);
		return computeSourceHash(sources);
	}

	function hashShort(h: string) {
		return h ? h.slice(0, 12) + '…' : '—';
	}

	function fmt(ms: number): string {
		return ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`;
	}

	$: hashState =
		!storedHash || !currentHash ? 'unknown' :
		storedHash === currentHash   ? 'match'   : 'mismatch';

	$: anyWorking = isWorking || isWorkerWorking;
</script>

<div class="page">
	<h2>Ledger Serialization Demo</h2>

	<section class="status-grid">
		<div class="status-row">
			<span class="label">Ledger loaded</span>
			<span class="value" class:ok={isLoaded} class:warn={!isLoaded}>
				{isLoaded ? `yes (${directiveCount} directives)` : 'no'}
			</span>
		</div>
		<div class="status-row">
			<span class="label">OPFS cache size</span>
			<span class="value">{cacheSize !== null ? `${cacheSize.toLocaleString()} bytes` : '—'}</span>
		</div>
		<div class="status-row">
			<span class="label">Stored hash</span>
			<span class="value mono">{hashShort(storedHash)}</span>
		</div>
		<div class="status-row">
			<span class="label">Current hash</span>
			<span class="value mono">{hashShort(currentHash)}</span>
			<span class="led {hashState}" title={hashState}></span>
		</div>
	</section>

	<section class="timing-grid">
		<div class="timing-row">
			<span class="timing-label">Serialize (main thread)</span>
			<span class="timing-value">{serializeMs !== null ? fmt(serializeMs) : '—'}</span>
		</div>
		<div class="timing-row">
			<span class="timing-label">Deserialize (main thread)</span>
			<span class="timing-value">{deserializeMs !== null ? fmt(deserializeMs) : '—'}</span>
		</div>
		<div class="timing-row">
			<span class="timing-label">Serialize (worker)</span>
			<span class="timing-value">{workerSerializeMs !== null ? fmt(workerSerializeMs) : '—'}</span>
		</div>
		<div class="timing-row">
			<span class="timing-label">Deserialize (worker)</span>
			<span class="timing-value">{workerDeserializeMs !== null ? fmt(workerDeserializeMs) : '—'}</span>
		</div>
	</section>

	<section class="actions-group">
		<div class="group-label">Main thread</div>
		<div class="actions">
			<button class="btn" on:click={handleSerialize} disabled={anyWorking}>
				Serialize → OPFS
			</button>
			<button class="btn" on:click={handleDeserialize} disabled={anyWorking || cacheSize === null}>
				Deserialize ← OPFS
			</button>
		</div>
	</section>

	<section class="actions-group">
		<div class="group-label">Web Worker</div>
		<div class="actions">
			<button class="btn" on:click={handleWorkerSerialize} disabled={anyWorking}>
				Serialize → OPFS
			</button>
			<button class="btn" on:click={handleWorkerDeserialize} disabled={anyWorking || cacheSize === null}>
				Deserialize ← OPFS
			</button>
		</div>
	</section>

	<section class="actions-group">
		<div class="group-label">Common</div>
		<div class="actions">
			<button class="btn" on:click={handleCalculateHash} disabled={anyWorking}>
				Calculate hash
			</button>
			<button class="btn" on:click={handleReset} disabled={anyWorking}>
				Reset instance
			</button>
		</div>
	</section>

	{#if status}
		<p class="status-msg">{status}</p>
	{/if}
</div>

<style>
	.page {
		padding: 1.5rem;
		max-width: 600px;
	}

	h2 {
		margin-bottom: 1.25rem;
	}

	.status-grid {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-bottom: 1rem;
		background: var(--surface-2, #1e1e2e);
		border-radius: 6px;
		padding: 1rem;
	}

	.status-row {
		display: flex;
		gap: 1rem;
		font-size: 0.9rem;
	}

	.label {
		width: 140px;
		flex-shrink: 0;
		opacity: 0.6;
	}

	.value {
		font-weight: 500;
	}

	.value.mono {
		font-family: monospace;
	}

	.value.ok {
		color: var(--color-ok, #a6e3a1);
	}

	.value.warn {
		color: var(--color-warn, #f38ba8);
	}

	.timing-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem 1.5rem;
		margin-bottom: 1.5rem;
		background: var(--surface-2, #1e1e2e);
		border-radius: 6px;
		padding: 1rem;
	}

	.timing-row {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.timing-label {
		font-size: 0.75rem;
		opacity: 0.55;
	}

	.timing-value {
		font-size: 1rem;
		font-weight: 600;
		font-family: monospace;
		color: var(--color-ok, #a6e3a1);
	}

	.actions-group {
		margin-bottom: 1rem;
	}

	.group-label {
		font-size: 0.75rem;
		opacity: 0.5;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.4rem;
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.status-msg {
		font-size: 0.875rem;
		opacity: 0.85;
		margin-top: 0.5rem;
	}

	.led {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		align-self: center;
		flex-shrink: 0;
		background: var(--color-led-unknown, #555);
		box-shadow: 0 0 3px 1px var(--color-led-unknown, #555);
	}

	.led.match {
		background: #a6e3a1;
		box-shadow: 0 0 4px 2px #a6e3a1;
	}

	.led.mismatch {
		background: #f38ba8;
		box-shadow: 0 0 4px 2px #f38ba8;
	}
</style>
