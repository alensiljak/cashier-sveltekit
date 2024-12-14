<script lang="ts">
	import { page } from '$app/stores';
	import type { StockSymbol } from '$lib/assetAllocation/AssetClass.js';
	import {
		SecurityAnalyser,
		type SecurityAnalysis
	} from '$lib/assetAllocation/securityAnalysis.js';
	import { CashierSync } from '$lib/cashier-sync.js';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { AaStocksStore } from '$lib/data/mainStore';
	import * as Formatter from '$lib/utils/formatter.js';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	const name = $page.params.name;
	let data = $state($page.data);
	let cursor = $state('');

	onMount(async () => {
		cursor = 'cursor-wait';

		// securityAnalysis
		data.stocks = await loadSecurityAnalysis(data.serverUrl, data.stocks as StockSymbol[]);

		cursor = '';
	});

	async function fetchAnalysisFor(symbol: string): Promise<SecurityAnalysis> {
		const svc = new SecurityAnalyser();

		const result: SecurityAnalysis = {
			yield: await svc.getYield(symbol),
			gainloss: await svc.getGainLoss(symbol)
		};
		return result;
	}

	/**
	 * Load security analysis for all symbols.
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

		for (let stock of symbols) {
			let symbol = stock.name;
			if (!stock) {
				throw new Error(`Stock ${symbol} not found!`);
			}

			// update the values
			if (!stock.analysis) {
				let analysis = await fetchAnalysisFor(symbol);
				stock.analysis = analysis;

				// update cache
				AaStocksStore.update((cache) => {
					if(!cache) return;
					// create a new object with the field.
					return {
						...cache,
						[symbol]: {
							...cache[symbol],
							analysis: analysis
						}
					}
				});
			}
		}

		return symbols;
	}

	async function runServerCheck(serverUrl: string): Promise<string> {
		const sync = new CashierSync(serverUrl);
		const result = await sync.healthCheck();
		return result;
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Asset Class Detail"></Toolbar>
	<section class={`h-full p-1 ${cursor}`}>
		<p>{name}</p>
		<p>Allocation: {data.assetClass?.allocation}</p>

		{#if data.stocks?.length === 0}
			<p>Loading...</p>
		{:else}
			<ul class="ms-4 mt-4">
				{#each data.stocks || [] as stock}
					<li class="mt-3">
						<h6 class="h6">
							• {stock.name}
						</h6>

						<!-- Analysis -->
						{#if stock.analysis}
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
								{account.currentValue}
								{account.currentCurrency}
							</div>
						{/each}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</article>
