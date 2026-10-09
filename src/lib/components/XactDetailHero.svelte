<script lang="ts">
	import type { Posting, Xact } from '#lib/data/model';
	import {
		formatPostingCost,
		formatPostingPrice,
		getAccountColour,
		getAmountColour,
		getReadableDate
	} from '#lib/utils/formatter';
	import { DateFormatStore } from '#lib/data/mainStore';
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

<!-- Larger, single-purpose layout for the xact-actions screen: card-style
     surface so the transaction reads as a single unit; payee is the
     dominant element, narration sits on its own muted line below it, and
     account names remain tappable (matching the app-wide `link link-primary`
     convention) so this replaces the separate "Payee:"/"Accounts:" list
     that used to duplicate this same information below the buttons. -->
<article class="bg-base-100 rounded-lg p-4 space-y-3">
	<div>
		<time class="font-mono text-sm tracking-wide opacity-60"
			>{getReadableDate(xact.date ?? '', $DateFormatStore)}</time
		>
		{#if xact.flag === '!'}
			<WarningTriangleIcon class="ml-1 inline-block size-4 align-text-bottom" />
		{/if}
	</div>

	<div>
		{#if xact.payee}
			<button
				type="button"
				class="text-left align-baseline text-2xl leading-snug font-bold underline decoration-1 decoration-current/50 underline-offset-4"
				disabled={!onPayeeClick}
				onclick={onPayeeClick}
			>
				{xact.payee}
			</button>
		{/if}
		{#if xact.note}
			<div class="opacity-70">{xact.note}</div>
		{/if}
	</div>

	<div class="border-base-content/20 border-t"></div>

	{#if xact.postings}
		<div class="font-mono text-sm space-y-2.5">
			{#each xact.postings as posting (posting)}
				{@const cost = formatPostingCost(posting)}
				{@const price = formatPostingPrice(posting)}
				{@const sep = posting.account.lastIndexOf(':')}
				<div class="space-y-0.5">
					<button
						type="button"
						class="flex w-full min-w-0 items-baseline text-left"
						disabled={!onAccountClick}
						onclick={() => onAccountClick?.(posting)}
					>
						{#if sep === -1}
							<span class="underline decoration-current/50 {getAccountColour(posting.account)}"
								>{posting.account}</span
							>
						{:else}
							<span
								class="min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap opacity-85 {getAccountColour(
									posting.account
								)}">{posting.account.slice(0, sep + 1)}</span
							><span
								class="shrink-0 whitespace-nowrap underline decoration-current/50 {getAccountColour(
									posting.account
								)}"
								>{posting.account.slice(sep + 1)}</span
							>
						{/if}
					</button>
					<div class="flex flex-row items-baseline justify-end gap-3">
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
