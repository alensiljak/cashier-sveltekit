<script lang="ts">
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import ExpensesDonutChart from '$lib/components/ExpensesDonutChart.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { ListSearch } from '$lib/utils/ListSearch';
	import { onMount } from 'svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { goto } from '$app/navigation';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import appService from '$lib/services/appService';
	import { formatAmount } from '$lib/utils/formatter';
	import {
		commoditiesFromDirectives,
		type CommodityDirective
	} from '$lib/assetAllocation/commodityYield';
	import { getSecuritiesList, type SecurityListItem } from '$lib/assetAllocation/securityReturns';

	let searchTerm = $state('');
	let rows: SecurityListItem[] = $state([]);
	let dataLoaded = $state(false);
	let reportCurrency = $state('');
	let showClosed = $state(false);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		document.body.style.cursor = 'wait';

		await fullLedgerService.ensureLoaded();
		reportCurrency = (await appService.getDefaultCurrency()) ?? '';
		const directives = commoditiesFromDirectives(
			(await fullLedgerService.getDirectives()) as unknown[]
		) as CommodityDirective[];

		rows = await getSecuritiesList(
			fullLedgerService.query.bind(fullLedgerService),
			directives,
			reportCurrency,
			showClosed
		);

		dataLoaded = true;
		document.body.style.cursor = 'default';
	}

	const filtered: SecurityListItem[] = $derived.by(() => {
		if (!searchTerm) return rows;
		const regex = new ListSearch().getRegex(searchTerm);
		return rows.filter(
			(r) => regex.test(r.symbol) || (r.name ? regex.test(r.name) : false)
		);
	});
	const summary = $derived.by(() => {
		let marketValue = 0;
		let costBasis = 0;
		let gainLoss = 0;
		const labels: string[] = [];
		const values: number[] = [];
		for (const r of filtered) {
			marketValue += r.marketValue;
			costBasis += r.costBasis;
			gainLoss += r.gainLoss;
			if (r.marketValue > 0) {
				labels.push(r.symbol);
				values.push(r.marketValue);
			}
		}
		const gainLossPct = costBasis === 0 ? 0 : (gainLoss / costBasis) * 100;
		return { marketValue, costBasis, gainLoss, gainLossPct, labels, values };
	});

	function onSelect(symbol: string) {
		goto('/commodities/detail?symbol=' + encodeURIComponent(symbol));
	}

	function onSearch(value: string) {
		searchTerm = value;
	}
</script>

<main class="flex flex-col h-full">
	<Toolbar title="Securities">
		{#snippet actions()}
			<HelpButton topic="securities" />
		{/snippet}
		{#snippet menuItems()}
			<label class="btn btn-primary flex w-full flex-row border-0 cursor-pointer">
				<span class="grow text-start font-normal">Show Closed</span>
				<input
					type="checkbox"
					class="toggle toggle-sm bg-transparent bg-none"
					bind:checked={showClosed}
					onchange={loadData}
				/>
			</label>
		{/snippet}
	</Toolbar>
	<SearchToolbar focus {onSearch} />

	<!-- Column header -->
	<div
		class="flex items-center gap-2 px-2 py-1 text-xs font-semibold uppercase opacity-50"
	>
		<div class="flex-1 min-w-0">Symbol</div>
		<div class="w-28 text-right">Last</div>
		<div class="w-28 text-right">Value</div>
		<div class="w-24 text-right">Gain/Loss</div>
	</div>

	<div class="flex-1 overflow-y-auto touch-pan-y px-1">
		{#if dataLoaded}
		<!-- Portfolio summary -->
		<div class="px-3 pt-3">
			<div class="bg-base-200 flex items-center gap-3 rounded-box p-3">
				<div class="h-28 w-28 shrink-0">
					<ExpensesDonutChart
						labels={summary.labels}
						values={summary.values}
						height="7rem"
						onclick={onSelect}
					/>
				</div>
				<div class="min-w-0 flex-1">
					<div class="text-xs uppercase opacity-50">Investments</div>
					<div class="text-2xl font-semibold">
						{formatAmount(summary.marketValue)}
						<span class="text-sm opacity-50">{reportCurrency}</span>
					</div>
					<div class="mt-1 text-sm opacity-70">Cost {formatAmount(summary.costBasis)}</div>
					<div class="text-sm {summary.gainLoss >= 0 ? 'text-success' : 'text-error'}">
						{summary.gainLoss >= 0 ? '+' : ''}{formatAmount(summary.gainLoss)}
						<span class="opacity-70">
							({summary.gainLoss >= 0 ? '+' : ''}{summary.gainLossPct.toFixed(2)}%)
						</span>
					</div>
				</div>
			</div>
		</div>
			{#each filtered as row (row.symbol)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="border-base-content/15 flex items-center gap-2 border-b py-2 px-1 cursor-pointer transition-colors hover:bg-base-content/5"
					onclick={() => onSelect(row.symbol)}
					role="listitem"
				>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2">
							<span class="font-mono font-medium">{row.symbol}</span>
							{#if row.closed}
								<span class="badge badge-sm badge-ghost">Closed</span>
							{/if}
						</div>
						{#if row.name}
							<div class="text-xs opacity-60 truncate">{row.name}</div>
						{/if}
					</div>
					<div class="w-28 text-right text-sm">
						{#if row.lastPrice != null}
							{formatAmount(row.lastPrice)}
							<span class="text-xs opacity-50">{row.lastPriceCurrency}</span>
						{:else}
							<span class="opacity-40">—</span>
						{/if}
					</div>
					<div class="w-28 text-right text-sm">
						{#if row.closed}
							<span class="opacity-50">Closed</span>
						{:else}
							{formatAmount(row.marketValue)}
							<span class="text-xs opacity-50">{reportCurrency}</span>
						{/if}
					</div>
					<div class="w-24 text-right">
						<div
							class="font-mono text-sm {row.gainLoss >= 0
								? 'text-success'
								: 'text-error'}"
						>
							{row.gainLossPct >= 0 ? '+' : ''}{row.gainLossPct.toFixed(2)}%
						</div>
						<div
							class="text-xs {row.gainLoss >= 0
								? 'text-success/70'
								: 'text-error/70'}"
						>
							{row.gainLoss >= 0 ? '+' : ''}{formatAmount(row.gainLoss)}
						</div>
					</div>
				</div>
			{/each}
			{#if filtered.length === 0}
				<div class="flex h-32 items-center justify-center opacity-50">
					<p class="text-sm">No securities found.</p>
				</div>
			{/if}
		{:else}
			<div class="flex h-full items-center justify-center">
				<span class="loading loading-spinner loading-lg"></span>
			</div>
		{/if}
	</div>
	<!-- Fixed totals -->
	<div
		class="border-base-content/15 flex items-center gap-2 border-t bg-base-100 px-2 py-2"
	>
		<div class="flex-1 min-w-0 font-semibold">Total</div>
		<div class="w-28 text-right text-sm opacity-40">—</div>
		<div class="w-28 text-right text-sm font-medium">
			{formatAmount(summary.marketValue)}
			<span class="text-xs opacity-50">{reportCurrency}</span>
		</div>
		<div class="w-24 text-right">
			<div
				class="font-mono text-sm {summary.gainLoss >= 0
					? 'text-success'
					: 'text-error'}"
			>
				{summary.gainLoss >= 0 ? '+' : ''}{summary.gainLossPct.toFixed(2)}%
			</div>
			<div
				class="text-xs {summary.gainLoss >= 0
					? 'text-success/70'
					: 'text-error/70'}"
			>
				{summary.gainLoss >= 0 ? '+' : ''}{formatAmount(summary.gainLoss)}
			</div>
		</div>
	</div>
</main>
