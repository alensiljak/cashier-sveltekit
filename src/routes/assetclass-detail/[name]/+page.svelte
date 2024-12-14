<script lang="ts">
	import { page } from '$app/stores';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import * as Formatter from '$lib/utils/formatter.js';
	import { onMount } from 'svelte';

	const name = $page.params.name;
	export let data;

	onMount(() => {
		// console.debug(name);
		// console.debug(data);
	});
</script>

<article>
	<Toolbar title="Asset Class Detail"></Toolbar>
	<section class="p-1">
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
								Yield: <span class={`${Formatter.getColourForYield(stock.analysis.yield)}`}>{stock.analysis.yield}</span>
								<!-- style="@(GetColourStyleForYield(stock.Analysis.Yield))" -->
								Gain/Loss: <span>{stock.analysis.gainLoss}</span>
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
