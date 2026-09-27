<script lang="ts">
	import type { Posting, Xact } from '$lib/data/model';
	import { formatPostingCost, formatPostingPrice, getAmountColour } from '$lib/utils/formatter';
	import WarningTriangleIcon from './WarningTriangleIcon.svelte';

	interface Props {
		xact: Xact;
		/** Navigate to the transactions filtered by this payee. */
		onPayeeClick?: () => void;
		/** Navigate to the transactions filtered by this account/posting. */
		onAccountClick?: (posting: Posting) => void;
	}
	let { xact, onPayeeClick, onAccountClick }: Props = $props();
</script>

<!-- Larger, single-purpose layout for the xact-actions screen: payee and
     account names are links (matching the app-wide `link link-primary`
     convention) so tapping them replaces the separate "Payee:"/"Accounts:"
     list that used to duplicate this same information below the buttons. -->
<article class="space-y-3">
	<div>
		<time class="text-base opacity-60">{xact.date}</time>
		{#if xact.flag === '!'}
			<WarningTriangleIcon class="ml-1 inline-block size-4 align-text-bottom" />
		{/if}
	</div>

	<div class="text-xl leading-snug font-medium">
		{#if xact.payee}
			<button
				type="button"
				class="link link-primary text-left align-baseline font-medium"
				disabled={!onPayeeClick}
				onclick={onPayeeClick}
			>
				{xact.payee}
			</button>
		{/if}
		{#if xact.payee && xact.note}
			<span class="opacity-50">· </span>
		{/if}
		{#if xact.note}
			<span class={xact.payee ? 'opacity-70' : ''}>{xact.note}</span>
		{/if}
	</div>

	{#if xact.postings}
		<div class="space-y-1.5">
			{#each xact.postings as posting (posting)}
				{@const cost = formatPostingCost(posting)}
				{@const price = formatPostingPrice(posting)}
				{@const sep = posting.account.lastIndexOf(':')}
				<div class="flex items-baseline gap-3">
					<button
						type="button"
						class="min-w-0 flex-auto overflow-hidden text-left text-base text-ellipsis whitespace-nowrap"
						disabled={!onAccountClick}
						onclick={() => onAccountClick?.(posting)}
					>
						{#if sep === -1}
							<span class="link link-primary">{posting.account}</span>
						{:else}
							<span class="opacity-60">{posting.account.slice(0, sep + 1)}</span
							><span class="link link-primary">{posting.account.slice(sep + 1)}</span>
						{/if}
					</button>
					<div class="ml-auto flex shrink-0 flex-row items-baseline gap-3">
						{#if cost}
							<data class="font-mono text-xs opacity-45">{cost}</data>
						{/if}
						{#if price}
							<data class="font-mono text-xs opacity-45">{price}</data>
						{/if}
						<data class={`text-base ${getAmountColour(posting.amount as number)}`}>
							{posting.amount} {posting.currency}
						</data>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if xact.meta && Object.keys(xact.meta).length > 0}
		<div class="space-y-0.5 opacity-70">
			{#each Object.entries(xact.meta) as [key, value] (key)}
				<div class="flex flex-row gap-1 text-xs">
					<data class="font-mono">{key}:</data>
					<data class="truncate">{value}</data>
				</div>
			{/each}
		</div>
	{/if}
</article>
