<script lang="ts">
	import type { Xact } from '$lib/data/model';
	import { formatPostingCost, formatPostingPrice, getAmountColour } from '$lib/utils/formatter';
	import WarningTriangleIcon from './WarningTriangleIcon.svelte';

	interface Props {
		xact: Xact;
		onclick?: (xact: Xact) => void;
	}
	let { xact, onclick }: Props = $props();

	function onRowClicked() {
		if (onclick) {
			onclick(xact);
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article onclick={onRowClicked}>
	<!-- date/payee -->
	<div class="flex flex-row space-x-2">
		<time class="opacity-85">
			{xact.date}
			<!-- todo: ISO format -->
		</time>
		<div class="flex items-center gap-1">
			{#if xact.flag === '!'}
				<WarningTriangleIcon class="size-4 shrink-0" />
			{/if}
			{xact.payee}{#if xact.payee && xact.note}<span class="opacity-50"> · {xact.note}</span>{:else if xact.note}{xact.note}{/if}
		</div>
	</div>

	<!-- postings -->
	{#if xact.postings}
		<div class="pl-6 leading-4">
			{#each xact.postings as posting (posting)}
				{@const cost = formatPostingCost(posting)}
				{@const price = formatPostingPrice(posting)}
				<div class="flex flex-wrap opacity-85">
					<data class="w-full text-sm sm:flex-1 sm:w-auto">{posting.account}</data>
					<div class="flex flex-row items-baseline gap-4 ml-auto shrink-0">
						{#if cost}
							<data class="text-xs opacity-45 font-mono">{cost}</data>
						{/if}
						{#if price}
							<data class="text-xs opacity-45 font-mono">{price}</data>
						{/if}
						<data class={getAmountColour(posting.amount as number)}>
							{posting.amount} {posting.currency}
						</data>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- metadata -->
	{#if xact.meta && Object.keys(xact.meta).length > 0}
		<div class="pl-6 leading-4 opacity-70">
			{#each Object.entries(xact.meta) as [key, value] (key)}
				<div class="flex flex-row gap-1 text-xs">
					<data class="font-mono">{key}:</data>
					<data class="truncate">{value}</data>
				</div>
			{/each}
		</div>
	{/if}
</article>
