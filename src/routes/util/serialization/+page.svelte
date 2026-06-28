<script lang="ts">
/*
 * Demonstration of serializing the full ledger state to a binary format
 * and saving it in OPFS, then restoring it back. This is used to
 * avoid expensive parsing and booking.
 */

	import { onMount } from 'svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { computeSourceHash } from '$lib/services/rustledger';
	import { getFileMetadata } from '$lib/utils/opfslib';
	import { listFileTree } from '$lib/utils/opfslib';
	import { OPFSBackend } from '$lib/storage/opfsBackend';
	import { LEDGER_CACHE_FILE, LEDGER_CACHE_HASH_FILE } from '$lib/constants';
	import Toolbar from '$lib/components/Toolbar.svelte';

	let status = '';
	let isLoaded = false;
	let loading = false;
	let loadError: string | null = null;
	let cacheSize: number | null = null;
	let currentHash = '';
	let cachedHash = '';
	let directiveCount = 0;
	let isWorking = false;

	onMount(async () => {
		await refreshStatus();
	});

	async function handleLoad() {
		loading = true;
		loadError = null;
		try {
			await fullLedgerService.load();
			await refreshStatus();
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function refreshStatus() {
		isLoaded = fullLedgerService.isLoaded;
		directiveCount = (await fullLedgerService.getDirectives()).length;

		const meta = await getFileMetadata(LEDGER_CACHE_FILE);
		cacheSize = meta?.size ?? null;

		const opfs = new OPFSBackend();
		cachedHash = (await opfs.readFile(LEDGER_CACHE_HASH_FILE)) ?? '';
	}

	async function handleSerialize() {
		isWorking = true;
		status = 'Loading ledger...';
		try {
			await fullLedgerService.ensureLoaded();

			status = 'Serializing...';
			const result = await fullLedgerService.serialize();

			const fileMap = await loadOpfsFileMap();
			currentHash = hashFileMap(fileMap);

			const opfs = new OPFSBackend();
			await opfs.writeFile(LEDGER_CACHE_HASH_FILE, currentHash);

			status = `Serialized ${result.bytes.toLocaleString()} bytes to OPFS.`;
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

			status = `Restored from cache (${result.directiveCount} directives).`;
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

	async function handleDeleteCache() {
		await fullLedgerService.deleteCache();
		const opfs = new OPFSBackend();
		await opfs.writeFile(LEDGER_CACHE_HASH_FILE, '');
		currentHash = '';
		cachedHash = '';
		status = 'Cache deleted and ledger instance freed.';
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

</script>

<Toolbar title="Ledger Serialization"></Toolbar>
<article class="p-4 max-w-xl space-y-6">

	<!-- Section 1: Ledger Instance -->
	<section>
		<h2 class="text-base font-semibold mb-3 opacity-70 uppercase tracking-wide">Ledger Instance</h2>

		<!-- Loaded indicator -->
		<div class="mb-3 flex items-center gap-3 rounded-md border bg-base-200 px-4 py-3">
			<span
				class="inline-block h-3 w-3 flex-shrink-0 rounded-full"
				class:bg-green-500={isLoaded && !loading}
				class:bg-red-500={!isLoaded && !loading}
				class:bg-yellow-400={loading}
				title={loading ? 'Loading…' : isLoaded ? 'Ledger loaded' : 'Ledger not loaded'}
			></span>
			<span class="flex-1 text-sm">
				{#if loading}
					Loading…
				{:else if isLoaded}
					Ledger loaded ({directiveCount} directives)
				{:else if loadError}
					Error: {loadError}
				{:else}
					Ledger not loaded
				{/if}
			</span>
			<button class="btn btn-sm" on:click={handleLoad} disabled={loading}>
				{loading ? 'Loading…' : 'Load'}
			</button>
		</div>

		<!-- Instance actions -->
		<div class="flex flex-wrap gap-2">
			<button class="btn btn-primary btn-sm" on:click={handleSerialize} disabled={isWorking}>
				Serialize → OPFS
			</button>
			<button class="btn btn-secondary btn-sm" on:click={handleDeserialize} disabled={isWorking || cacheSize === null}>
				Deserialize ← OPFS
			</button>
			<button class="btn btn-outline btn-sm" on:click={handleReset} disabled={isWorking}>
				Reset instance
			</button>
		</div>
	</section>

	<!-- Section 2: OPFS Files -->
	<section>
		<h2 class="text-base font-semibold mb-3 opacity-70 uppercase tracking-wide">OPFS Cache</h2>

		<div class="card bg-base-200 shadow mb-3">
			<div class="card-body p-4 gap-2">
				<div class="flex items-center gap-4 text-sm">
					<span class="w-36 opacity-60 shrink-0">Cache size</span>
					<span class="font-medium">
						{cacheSize !== null ? `${cacheSize.toLocaleString()} bytes` : '—'}
					</span>
				</div>
				<div class="flex items-center gap-4 text-sm">
					<span class="w-36 opacity-60 shrink-0">Current hash</span>
					<span class="font-mono font-medium">{hashShort(currentHash)}</span>
				</div>
				<div class="flex items-center gap-4 text-sm">
					<span class="w-36 opacity-60 shrink-0">Cached hash</span>
					<span class="font-mono font-medium">{hashShort(cachedHash)}</span>
				</div>
				{#if currentHash && cachedHash}
					<div class="flex items-center gap-4 text-sm">
						<span class="w-36 opacity-60 shrink-0">Status</span>
						{#if currentHash === cachedHash}
							<span class="text-success font-medium">Cache is current</span>
						{:else}
							<span class="text-warning font-medium">Cache is stale — re-serialize</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- OPFS actions -->
		<div class="flex flex-wrap gap-2">
			<button class="btn btn-outline btn-sm" on:click={handleCalculateHash} disabled={isWorking} title="Hash all .bean source files currently in OPFS">
				Hash source files
			</button>
			<button class="btn btn-outline btn-error btn-sm" on:click={handleDeleteCache} disabled={isWorking}>
				Delete cache
			</button>
		</div>
	</section>

	{#if status}
		<div class="alert alert-soft text-sm py-2">
			{status}
		</div>
	{/if}
</article>
