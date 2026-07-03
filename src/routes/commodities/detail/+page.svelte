<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import PriceHistoryChart from '$lib/components/PriceHistoryChart.svelte';
	import type { PricePoint } from '$lib/components/PriceHistoryChart.svelte';
	import { ArrowLeftRightIcon } from '@lucide/svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import appService from '$lib/services/appService';
	import {
		computeCommodityYield,
		commoditiesFromDirectives,
		type CommodityYieldResult
	} from '$lib/assetAllocation/commodityYield';

	type CommodityDirective = {
		currency: string;
		date: string;
		meta: Record<string, unknown>;
	};

	const symbol = $derived(decodeURIComponent(page.url.searchParams.get('symbol') ?? ''));

	let commodity: CommodityDirective | null = $state(null);
	let dataLoaded = $state(false);
	let pricePoints: PricePoint[] = $state([]);
	let lastPrice: PricePoint | null = $state(null);
	let securityYield: CommodityYieldResult | null = $state(null);
	let yieldError: string | null = $state(null);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		await fullLedgerService.ensureLoaded();

		// Load commodity directive
		const directives = (await fullLedgerService.getDirectives()) as any[];
		const allCommodities = commoditiesFromDirectives(directives);
		const found = directives.find((d) => d.type === 'commodity' && d.currency === symbol);
		if (found) {
			commodity = {
				currency: String(found.currency ?? ''),
				date: String(found.date ?? ''),
				meta: (found.meta as Record<string, unknown>) ?? {}
			};
		}

		if (commodity) {
			try {
				const reportCurrency = await appService.getDefaultCurrency();
				securityYield = await computeCommodityYield(
					fullLedgerService.query.bind(fullLedgerService),
					commodity,
					allCommodities,
					reportCurrency
				);
			} catch (e) {
				yieldError = e instanceof Error ? e.message : String(e);
			}
		}
		// Load full price history for this symbol via BQL — runs against in-memory
		// WASM data so no disk I/O; even 5y of daily prices (~1300 rows) is sub-ms.
		const { columns, rows } = await fullLedgerService.query(
			`SELECT date, currency, amount FROM prices WHERE currency = '${symbol}' ORDER BY date`
		);
		if (rows.length > 0) {
			const dateIdx = columns.indexOf('date');
			const amtIdx = columns.indexOf('amount');
			pricePoints = (rows as any[]).flatMap((row) => {
				const rawDate = row[dateIdx];
				const rawAmt = row[amtIdx] as { number?: string | number; currency?: string } | null;
				const price = rawAmt?.number != null ? parseFloat(String(rawAmt.number)) : NaN;
				if (isNaN(price)) return [];
				const dateStr =
					typeof rawDate === 'string'
						? rawDate.slice(0, 10)
						: rawDate instanceof Date
							? rawDate.toISOString().slice(0, 10)
							: String(rawDate).slice(0, 10);
				return [{ date: dateStr, price, priceCurrency: rawAmt?.currency ?? '' }];
			});
			lastPrice = pricePoints.length > 0 ? pricePoints[pricePoints.length - 1] : null;
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

<main class="flex h-screen flex-col">
	<Toolbar title="Commodity">
		{#snippet actions()}
			<HelpButton topic="commodity-detail" />
		{/snippet}
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

			<!-- Last price box -->
			{#if lastPrice}
				<div class="mx-auto max-w-md mt-4 overflow-hidden rounded-xl bg-base-100 shadow">
					<div class="flex items-center justify-between px-4 py-3">
						<span class="text-sm font-medium opacity-50">Last price</span>
						<div class="text-right">
							<span class="font-mono font-semibold">
								{lastPrice.price.toLocaleString(undefined, {
									minimumFractionDigits: 2,
									maximumFractionDigits: 4
								})}
								{lastPrice.priceCurrency}
							</span>
							<span class="ml-2 text-xs opacity-40">{lastPrice.date}</span>
						</div>
					</div>
				</div>
			{/if}

			<!-- Yield (TTM) box — linked via isin/ticker metadata when declared -->
			{#if securityYield}
				<div class="mx-auto max-w-md mt-4 overflow-hidden rounded-xl bg-base-100 shadow">
					<div class="flex items-center justify-between px-4 py-3">
						<span class="text-sm font-medium opacity-50">Yield (TTM)</span>
						<span class="font-mono font-semibold">{securityYield.yieldPct}</span>
					</div>
					<div class="flex items-center justify-between border-t border-base-content/10 px-4 py-2">
						<span class="text-xs opacity-40">Linked by</span>
						<span class="text-xs opacity-60">
							{securityYield.matchedBy === 'symbol'
								? 'currency code (no isin/ticker meta)'
								: securityYield.matchedBy}
							{#if securityYield.linkedCurrencies.length > 1}
								&nbsp;({securityYield.linkedCurrencies.join(', ')})
							{/if}
						</span>
					</div>
				</div>
			{:else if yieldError}
				<div class="mx-auto max-w-md mt-4 overflow-hidden rounded-xl bg-base-100 shadow px-4 py-3">
					<span class="text-xs text-error">Yield unavailable: {yieldError}</span>
				</div>
			{/if}

			<!-- Metadata table -->
			{#if visibleMeta(commodity.meta).length > 0}
				<div class="mx-auto max-w-md mt-4 overflow-hidden rounded-xl bg-base-100 shadow">
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

			<!-- Price history chart -->
			{#if pricePoints.length > 0}
				<div class="mx-auto max-w-md mt-6 overflow-hidden rounded-xl bg-base-100 shadow p-3">
					<p class="text-xs font-medium opacity-50 mb-1 px-1">Price history</p>
					<PriceHistoryChart points={pricePoints} priceCurrency={lastPrice?.priceCurrency ?? ''} />
				</div>
			{/if}
		{/if}
	</section>
</main>
