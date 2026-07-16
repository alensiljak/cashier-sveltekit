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
	<!-- date / payee / narration — inline flow; hanging indent aligns wrapped lines with postings -->
	<div class="pl-6" style="text-indent: -1.5rem"><time class="opacity-85">{xact.date}</time>{#if xact.flag === '!'} <WarningTriangleIcon class="size-4 inline-block align-text-bottom" />{/if} {xact.payee || xact.note}{#if xact.payee && xact.note} <span class="opacity-50">· {xact.note}</span>{/if}</div>

	<!-- postings -->
	{#if xact.postings}
		<div class="pl-6 leading-4">
			{#each xact.postings as posting (posting)}
				{@const cost = formatPostingCost(posting)}
				{@const price = formatPostingPrice(posting)}
				{@const sep = posting.account.indexOf(':')}
				<div class="flex opacity-85">
					<data class="flex min-w-0 flex-auto overflow-hidden text-sm">
						{#if sep === -1}
							<span class="overflow-hidden text-ellipsis whitespace-nowrap">{posting.account}</span>
						{:else}
							<span class="shrink-0">{posting.account.slice(0, sep + 1)}</span>
							<span class="min-w-0 overflow-hidden whitespace-nowrap text-ellipsis [direction:rtl]">{posting.account.slice(sep + 1)}</span>
						{/if}
					</data>
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
