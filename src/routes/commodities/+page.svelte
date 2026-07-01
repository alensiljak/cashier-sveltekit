<script lang="ts">
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { ListSearch } from '$lib/utils/ListSearch';
	import { onMount } from 'svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { goto } from '$app/navigation';
	import HelpButton from '$lib/help/HelpButton.svelte';

	type CommodityRow = { currency: string; date: string; meta: Record<string, unknown> };

	let searchTerm = $state('');
	let allCommodities: CommodityRow[] = $state([]);
	let dataLoaded = $state(false);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		document.body.style.cursor = 'wait';

		await fullLedgerService.ensureLoaded();
		const directives = (await fullLedgerService.getDirectives()) as any[];
		allCommodities = directives
			.filter((d) => d.type === 'commodity')
			.map((d) => ({
				currency: String(d.currency ?? ''),
				date: String(d.date ?? ''),
				meta: (d.meta as Record<string, unknown>) ?? {}
			}))
			.sort((a, b) => a.currency.localeCompare(b.currency));

		dataLoaded = true;
		document.body.style.cursor = 'default';
	}

	const filteredCommodities: CommodityRow[] = $derived.by(() => {
		if (!searchTerm) return allCommodities;
		const search = new ListSearch();
		const regex = search.getRegex(searchTerm);
		return allCommodities.filter((c) => regex.test(c.currency));
	});

	function onCommoditySelected(currency: string) {
		goto('/commodities/detail?symbol=' + encodeURIComponent(currency));
	}

	function onSearch(value: string) {
		searchTerm = value;
	}
</script>

<main class="flex flex-col h-full">
	<Toolbar title="Commodities">
		{#snippet actions()}
			<HelpButton topic="commodities" />
		{/snippet}
	</Toolbar>
	<!-- search toolbar -->
	<SearchToolbar focus {onSearch} />
	<!-- Commodity list -->
	<div class="flex-1 overflow-y-auto touch-pan-y px-1">
		{#if dataLoaded}
			{#each filteredCommodities as row (row.currency)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="border-base-content/15 flex items-center justify-between border-b py-2 px-1 cursor-pointer transition-colors hover:bg-base-content/5"
					onclick={() => onCommoditySelected(row.currency)}
					role="listitem"
				>
					<div class="flex-1 pl-1 font-mono font-medium">{row.currency}</div>
					{#if row.meta?.name && typeof row.meta.name === 'string'}
						<span class="text-sm opacity-60 pr-1 truncate max-w-[55%] text-right">{row.meta.name}</span>
					{/if}
				</div>
			{/each}
			{#if filteredCommodities.length === 0}
				<div class="flex h-32 items-center justify-center opacity-50">
					<p class="text-sm">No commodities found.</p>
				</div>
			{/if}
		{:else}
			<div class="flex h-full items-center justify-center">
				<span class="loading loading-spinner loading-lg"></span>
			</div>
		{/if}
	</div>
</main>
