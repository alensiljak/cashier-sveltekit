<script lang="ts">
	import { page } from '$app/state';
	import type { StockSymbol } from '$lib/assetAllocation/AssetClass.js';
	import {
		SecurityAnalyser,
		type SecurityAnalysis
	} from '$lib/assetAllocation/securityAnalysis.js';
	import { CashierSync } from '$lib/cashier-sync.js';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { AaStocksStore } from '$lib/data/mainStore';
	import { SettingKeys, settings } from '$lib/settings';
	import * as Formatter from '$lib/utils/formatter.js';
	import { processWithConcurrencyLimit } from '$lib/utils/concurrency.js';
	import { Loader, X } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	const name = page.params.name;
	let data = $state(page.data);
	let cursor = $state('');

	onMount(async () => {
		cursor = 'cursor-wait';

		// securityAnalysis
		data.stocks = await loadSecurityAnalysis(data.serverUrl, data.stocks as StockSymbol[]);

		cursor = '';
	});

	async function fetchAnalysisFor(symbol: string): Promise<SecurityAnalysis> {
		const svc = new SecurityAnalyser();

		// Parallelize yield and gainloss API calls
		const [yieldResult, gainlossResult] = await Promise.all([
			svc.getYield(symbol),
			svc.getGainLoss(symbol)
		]);

		return {
			yield: yieldResult,
			gainloss: gainlossResult
		};
	}

	/**
	 * Load security analysis for all symbols.
	 * Processes stocks in batches of 3 for concurrent API calls.
	 */
	async function loadSecurityAnalysis(
		serverUrl: string,
		symbols: StockSymbol[]
	): Promise<StockSymbol[]> {
		if (!serverUrl) {
			throw new Error('Sync Server URL not set');
		}
		const alive = runServerCheck(serverUrl);
		if (!alive) {
			console.info('Server not online, aborting security analysis');
			return symbols;
		}

		// Filter stocks that need analysis
		const stocksToLoad = symbols.filter((stock) => !stock.analysis);

		// Process with concurrency limit of 10, showing results as each completes
		await processWithConcurrencyLimit(stocksToLoad, 10, async (stock) => {
			const symbol = stock.name;
			if (!stock) {
				console.error(`Stock ${symbol} not found!`);
				return;
			}

			// Mark as loading
			stock.loading = true;
			stock.error = undefined;
			// Trigger reactivity
			data.stocks = [...data.stocks];

			try {
				const analysis = await fetchAnalysisFor(symbol);
				stock.analysis = analysis;
				stock.loading = false;

				// Update cache sequentially after successful fetch
				AaStocksStore.update((cache) => {
					if (!cache) return cache;
					return {
						...cache,
						[symbol]: {
							...cache[symbol],
							analysis: analysis
						}
					};
				});
			} catch (err) {
				console.error(`Error loading analysis for ${symbol}:`, err);
				stock.loading = false;
				stock.error = err instanceof Error ? err.message : 'Failed to load';
			}

			// Trigger reactivity after state change
			data.stocks = [...data.stocks];
		});

		return symbols;
	}

	async function runServerCheck(serverUrl: string): Promise<string> {
		const ptaSystem = (await settings.get(SettingKeys.ptaSystem)) as string;

		const sync = new CashierSync(serverUrl, ptaSystem);
		const result = await sync.healthCheck();
		return result;
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Asset Class Detail"></Toolbar>
	<section class={`h-full p-1 ${cursor} overflow-y-auto`}>
		<p>{name}</p>
		<p>Allocation: {data.assetClass?.allocation}</p>

		{#if data.stocks?.length === 0}
			<p>Loading...</p>
		{:else}
			<ul class="ms-4 mt-4">
				{#each data.stocks || [] as stock}
					<li class="mt-3">
						<h6 class="h6 flex items-center gap-2">
							• {stock.name}
							{#if stock.loading}
								<Loader class="h-4 w-4 animate-spin" />
							{/if}
						</h6>

						<!-- Analysis -->
						{#if stock.error}
							<div class="text-error ms-3 flex items-center gap-1">
								<X class="h-4 w-4" />
								<span class="text-sm">Error loading analysis</span>
							</div>
						{:else if stock.analysis}
							<div class="ms-3">
								Yield: <span class={`${Formatter.getColourForYield(stock.analysis.yield)}`}
									>{stock.analysis.yield}</span
								>
								<!-- style="@(GetColourStyleForYield(stock.Analysis.Yield))" -->
								Gain/Loss:
								<span class={`${Formatter.getColourForGainLoss(stock.analysis.gainloss)}`}
									>{stock.analysis.gainloss}</span
								>
								<!-- style="@(GetColourStyle(stock.Analysis.GainLoss))" -->
							</div>
						{/if}

						<!-- Lots -->

						<!-- accounts -->
						{#each stock.accounts as account}
							<div class="ms-3">
								{account.name},
								{account.balance?.quantity}
								{account.balance?.currency},
								{account.currentValue.toFixed(2)}
								{account.currentCurrency}
							</div>
						{/each}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</article>
