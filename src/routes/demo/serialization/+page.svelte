<script lang="ts">
	import { onMount } from 'svelte';
	import fullLedgerService from '$lib/services/fullLedgerService';
	import { computeSourceHash } from '$lib/services/rustledger';
	import { settings, SettingKeys } from '$lib/settings';
	import { saveBinaryFile, readBinaryFile, getFileMetadata } from '$lib/utils/opfslib';

	const CACHE_FILE = 'ledger-cache.bin';

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
		directiveCount = fullLedgerService.getDirectives().length;

		const meta = await getFileMetadata(CACHE_FILE);
		cacheSize = meta?.size ?? null;

		storedHash = (await settings.get<string>(SettingKeys.ledgerCacheHash)) ?? '';
	}

	async function handleSerialize() {
		isWorking = true;
		status = 'Loading ledger...';
		try {
			await fullLedgerService.ensureLoaded();

			status = 'Serializing...';
			const bytes = fullLedgerService.serialize();
			await saveBinaryFile(CACHE_FILE, bytes);

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

	async function handleReset() {
		fullLedgerService.reset();
		currentHash = '';
		status = 'Ledger instance freed (not loaded).';
		await refreshStatus();
	}

	async function handleDeserialize() {
		isWorking = true;
		status = 'Reading cache from OPFS...';
		try {
			const bytes = await readBinaryFile(CACHE_FILE);
			if (!bytes) {
				status = 'No cache file found in OPFS. Serialize first.';
				return;
			}

			// Compare hashes before restoring
			const { fileMap } = await fullLedgerService.loadOpfsFileMap();
			currentHash = hashFileMap(fileMap);
			const hashMatch = storedHash && currentHash === storedHash;

			await fullLedgerService.loadFromCache(bytes);

			const directives = fullLedgerService.getDirectives().length;
			status = `Restored from cache (${bytes.length.toLocaleString()} bytes, ${directives} directives). Hash ${hashMatch ? 'matches ✓' : 'mismatch — sources may have changed'}.`;
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
			const { fileMap } = await fullLedgerService.loadOpfsFileMap();
			currentHash = hashFileMap(fileMap);
			status = `Hash calculated from ${Object.keys(fileMap).length} source file(s).`;
		} catch (e) {
			status = `Error: ${e}`;
		} finally {
			isWorking = false;
		}
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

	<section class="actions">
		<button on:click={handleSerialize} disabled={isWorking}>
			Serialize → OPFS
		</button>
		<button on:click={handleReset} disabled={isWorking}>
			Reset instance
		</button>
		<button on:click={handleDeserialize} disabled={isWorking || cacheSize === null}>
			Deserialize ← OPFS
		</button>
		<button on:click={handleCalculateHash} disabled={isWorking}>
			Calculate hash
		</button>
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
		margin-bottom: 1.5rem;
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

	.actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	button {
		padding: 0.5rem 1.1rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.9rem;
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
