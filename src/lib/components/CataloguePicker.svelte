<script lang="ts">
	import {
		getCatalogue,
		getCatalogueSelection,
		refreshCatalogue,
		saveCatalogueSelection,
		type StoredCatalogue
	} from '#lib/services/prices/priceCatalogueService';
	import { describeError } from '#lib/services/prices/priceDownloadService';
	import type { CatalogueProduct } from '#lib/services/prices/priceProvider';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import { untrack } from 'svelte';

	/**
	 * Download a provider's product catalogue on demand and choose which
	 * products routine downloads cover. Nothing here runs unless the user
	 * presses the button; the selection is what planning and downloads use.
	 */
	let {
		providerId,
		onchange
	}: { providerId: string; onchange?: () => void } = $props();

	let catalogue = $state<StoredCatalogue | null>(null);
	let selection = $state<CatalogueProduct[]>([]);
	let filter = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Reload whenever the provider changes.
	$effect(() => {
		const id = providerId;
		untrack(() => void load(id));
	});

	async function load(id: string) {
		catalogue = null;
		selection = [];
		filter = '';
		error = null;
		const [stored, chosen] = await Promise.all([getCatalogue(id), getCatalogueSelection(id)]);
		if (id !== providerId) return; // a newer provider switch won
		catalogue = stored;
		selection = chosen;
	}

	async function download() {
		const id = providerId;
		loading = true;
		error = null;
		try {
			const next = await refreshCatalogue(id);
			if (id === providerId) catalogue = next;
		} catch (e) {
			error = describeError(e);
		}
		loading = false;
	}

	const keyOf = (p: CatalogueProduct) => p.portId;
	const selectedKeys = $derived(new Set(selection.map(keyOf)));

	/** Catalogue products plus selected ones the latest catalogue no longer lists. */
	const products = $derived.by(() => {
		const listed = catalogue?.products ?? [];
		const listedKeys = new Set(listed.map(keyOf));
		return [...selection.filter((p) => !listedKeys.has(p.portId)), ...listed];
	});

	const visible = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		if (!q) return products;
		return products.filter((p) =>
			[p.label, p.apir, p.ticker].some((s) => s?.toLowerCase().includes(q))
		);
	});

	async function toggle(product: CatalogueProduct, checked: boolean) {
		const id = providerId;
		const next = checked
			? [...selection.filter((p) => p.portId !== product.portId), product]
			: selection.filter((p) => p.portId !== product.portId);
		selection = next;
		await saveCatalogueSelection(id, next);
		onchange?.();
	}
</script>

<div class="space-y-3">
	<div class="flex items-center gap-3">
		<div class="min-w-0 flex-1">
			<p class="text-sm font-medium">Product catalogue</p>
			<p class="text-xs opacity-60">
				{#if catalogue}
					{catalogue.products.length} products, downloaded {new Date(
						catalogue.fetchedAt
					).toLocaleString()}.
				{:else}
					Not downloaded yet. Download it once, then pick the products you want prices for.
				{/if}
			</p>
		</div>
		<button
			type="button"
			class="btn btn-primary btn-xs rounded shrink-0"
			disabled={loading}
			onclick={() => void download()}
		>
			{#if loading}<span class="loading loading-spinner loading-xs"></span>{:else}<DownloadIcon
					size={14}
				/>{/if}
			{catalogue ? 'Refresh' : 'Download'}
		</button>
	</div>

	{#if error}
		<div class="alert alert-error text-sm"><span>{error}</span></div>
	{/if}

	{#if products.length > 0}
		<div class="flex items-center gap-2">
			<input
				type="search"
				class="input input-bordered input-sm flex-1"
				placeholder="Filter by name, APIR or ticker"
				aria-label="Filter catalogue"
				bind:value={filter}
			/>
			<span class="text-xs opacity-60 shrink-0">{selection.length} selected</span>
		</div>

		<ul class="max-h-72 overflow-y-auto flex flex-col gap-1">
			{#each visible as product (product.portId)}
				<li>
					<label class="flex cursor-pointer items-center gap-2 text-sm">
						<input
							type="checkbox"
							class="checkbox checkbox-xs"
							checked={selectedKeys.has(product.portId)}
							onchange={(e) => void toggle(product, e.currentTarget.checked)}
						/>
						<span class="flex-1 min-w-0 truncate">{product.label}</span>
						<span class="text-xs opacity-60 shrink-0">{product.ticker ?? product.apir}</span>
					</label>
				</li>
			{:else}
				<li class="text-xs opacity-60">No products match the filter.</li>
			{/each}
		</ul>
	{/if}
</div>
