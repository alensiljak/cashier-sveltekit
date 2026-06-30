<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { ArrowLeftRightIcon } from '@lucide/svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	type CommodityDirective = {
		currency: string;
		date: string;
		meta: Record<string, unknown>;
	};

	const symbol = $derived(decodeURIComponent(page.url.searchParams.get('symbol') ?? ''));

	let commodity: CommodityDirective | null = $state(null);
	let dataLoaded = $state(false);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		await fullLedgerService.ensureLoaded();
		const directives = (await fullLedgerService.getDirectives()) as any[];
		const found = directives.find((d) => d.type === 'commodity' && d.currency === symbol);
		if (found) {
			commodity = {
				currency: String(found.currency ?? ''),
				date: String(found.date ?? ''),
				meta: (found.meta as Record<string, unknown>) ?? {}
			};
		}
		dataLoaded = true;
	}

	/** Internal Beancount metadata keys to skip in the UI. */
	const SKIP_META_KEYS = new Set(['filename', 'lineno']);

	function visibleMeta(meta: Record<string, unknown>): [string, unknown][] {
		return Object.entries(meta).filter(([k]) => !SKIP_META_KEYS.has(k));
	}

	function formatMetaValue(value: unknown): string {
		if (value === null || value === undefined) return '';
		if (typeof value === 'string') return value;
		if (typeof value === 'boolean' || typeof value === 'number') return String(value);
		if (typeof value === 'object' && 'number' in (value as Record<string, unknown>)) {
			const v = value as { number: string; currency: string };
			return `${v.number} ${v.currency}`;
		}
		return JSON.stringify(value);
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Commodity">
		{#snippet menuItems()}
			<ToolbarMenuItem
				text="Currency Converter"
				Icon={ArrowLeftRightIcon}
				onclick={() => goto(`/currency-converter?from=${encodeURIComponent(symbol)}`)}
			/>
		{/snippet}
	</Toolbar>
	<section class="flex-1 overflow-y-auto touch-pan-y p-4">
		{#if !dataLoaded}
			<div class="flex h-full items-center justify-center">
				<span class="loading loading-spinner loading-lg"></span>
			</div>
		{:else if !commodity}
			<div class="flex h-full flex-col items-center justify-center gap-2 opacity-50">
				<p class="font-mono text-4xl font-bold">{symbol}</p>
				<p class="text-sm">No commodity directive found.</p>
			</div>
		{:else}
			<!-- Central heading -->
			<div class="mb-8 flex flex-col items-center gap-1 pt-6 text-center">
				<h1 class="font-mono text-5xl font-bold tracking-widest">{commodity.currency}</h1>
				{#if typeof commodity.meta?.name === 'string'}
					<p class="mt-2 text-lg opacity-75">{commodity.meta.name}</p>
				{/if}
				<p class="mt-1 text-xs opacity-40">Declared {commodity.date}</p>
			</div>

			<!-- Metadata table -->
			{#if visibleMeta(commodity.meta).length > 0}
				<div class="mx-auto max-w-md overflow-hidden rounded-xl bg-base-100 shadow">
					{#each visibleMeta(commodity.meta) as [key, value], i (key)}
						<div
							class="flex items-start justify-between px-4 py-3 {i > 0
								? 'border-t border-base-content/10'
								: ''}"
						>
							<span class="shrink-0 text-sm font-medium opacity-50">{key}</span>
							<span class="ml-4 text-right text-sm break-all">{formatMetaValue(value)}</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</section>
</article>
