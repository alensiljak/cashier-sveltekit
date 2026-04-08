<script lang="ts">
/*
 * Demonstration of serializing the full ledger state to a binary format
 * and saving it in OPFS, then restoring it back. This is used to
 * avoid expensive parsing and booking.
 */

	import { onMount } from 'svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { computeSourceHash } from '$lib/services/rustledger';
	import { settings, SettingKeys } from '$lib/settings';
	import { getFileMetadata } from '$lib/utils/opfslib';
	import { listFileTree } from '$lib/utils/opfslib';
	import { OPFSBackend } from '$lib/storage';
	import { LEDGER_CACHE_FILE } from '$lib/constants';

	let status = '';
	let isLoaded = false;
	let cacheSize: number | null = null;
	let storedHash = '';
	let currentHash = '';
	let directiveCount = 0;
	let isWorking = false;

	onMount(async () => {
		await refreshStatus();
	});

	async function refreshStatus() {
		isLoaded = fullLedgerService.isLoaded;
		directiveCount = (await fullLedgerService.getDirectives()).length;

		const meta = await getFileMetadata(LEDGER_CACHE_FILE);
		cacheSize = meta?.size ?? null;

		storedHash = (await settings.get<string>(SettingKeys.ledgerCacheHash)) ?? '';
	}

	async function handleSerialize() {
		isWorking = true;
		status = 'Loading ledger...';
		try {
			await fullLedgerService.ensureLoaded();

			status = 'Serializing...';
			const result = await fullLedgerService.serialize();

			// Compute hash from source files and persist it
			const fileMap = await loadOpfsFileMap();
			currentHash = hashFileMap(fileMap);
			await settings.set(SettingKeys.ledgerCacheHash, currentHash);

			status = `Serialized ${result.bytes.toLocaleString()} bytes to OPFS. Hash saved.`;
			await refreshStatus();
		} catch (e) {
			status = `Error: ${e}`;
		} finally {
			isWorking = false;
		}
	}

	async function handleDeserialize() {
		isWorking = true;
		status = 'Restoring from cache...';
		try {
			const result = await fullLedgerService.loadFromCache();

			// Hash comparison
			const fileMap = await loadOpfsFileMap();
			currentHash = hashFileMap(fileMap);
			const hashMatch = storedHash && currentHash === storedHash;

			status = `Restored from cache (${result.directiveCount} directives). Hash ${hashMatch ? 'matches' : 'mismatch — sources may have changed'}.`;
			await refreshStatus();
		} catch (e) {
			status = `Error: ${e}`;
		} finally {
			isWorking = false;
		}
	}

	async function handleCalculateHash() {
		isWorking = true;
		status = 'Reading OPFS files...';
		try {
			const fileMap = await loadOpfsFileMap();
			currentHash = hashFileMap(fileMap);
			status = `Hash calculated from ${Object.keys(fileMap).length} source file(s).`;
		} catch (e) {
			status = `Error: ${e}`;
		} finally {
			isWorking = false;
		}
	}

	async function handleReset() {
		await fullLedgerService.reset();
		currentHash = '';
		status = 'Ledger instance freed (not loaded).';
		await refreshStatus();
	}

	async function loadOpfsFileMap(): Promise<Record<string, string>> {
		const opfs = new OPFSBackend();
		const tree = await listFileTree();
		const beanEntries = tree.filter((e) => e.kind === 'file' && e.name.endsWith('.bean'));

		const fileMap: Record<string, string> = {};
		await Promise.all(
			beanEntries.map(async (entry) => {
				const content = await opfs.readFile(entry.path);
				if (content !== undefined) {
					fileMap[entry.path] = content;
				}
			})
		);
		return fileMap;
	}

	function hashFileMap(fileMap: Record<string, string>): string {
		const sources = Object.keys(fileMap).sort().map((k) => fileMap[k]);
		return computeSourceHash(sources);
	}

	function hashShort(h: string) {
		return h ? h.slice(0, 12) + '…' : '—';
	}

	$: hashState =
		!storedHash || !currentHash ? 'unknown' :
		storedHash === currentHash   ? 'match'   : 'mismatch';
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

	<section class="actions-group">
		<div class="actions">
			<button class="btn" on:click={handleSerialize} disabled={isWorking}>
				Serialize → OPFS
			</button>
			<button class="btn" on:click={handleDeserialize} disabled={isWorking || cacheSize === null}>
				Deserialize ← OPFS
			</button>
			<button class="btn" on:click={handleCalculateHash} disabled={isWorking}>
				Calculate hash
			</button>
			<button class="btn" on:click={handleReset} disabled={isWorking}>
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

	.actions-group {
		margin-bottom: 1rem;
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
