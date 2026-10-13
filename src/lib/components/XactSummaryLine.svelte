<script lang="ts">
	import { TriangleAlertIcon } from '@lucide/svelte';

	/**
	 * Compact one-entry summary: date, flag, payee · note, with the amount right-aligned.
	 * When the description wraps, the amount sits on the last line. Wrapped lines hang-indent.
	 * Not to be confused with JournalXactRow, which renders the full transaction with postings.
	 */
	interface Props {
		/** Already formatted for display. */
		date: string;
		payee?: string | null;
		note?: string | null;
		flag?: string | null;
		/** Already formatted for display. */
		amount: string;
		currency?: string | null;
		/** Colour class for the amount. */
		amountClass?: string;
		/** Extra inline content after the description, e.g. the account name. */
		extra?: string | null;
	}

	let { date, payee, note, flag, amount, currency, amountClass = '', extra }: Props = $props();
</script>

<div class="flex min-w-0 grow items-end justify-between gap-2">
	<div class="min-w-0 pl-6" style="text-indent: -1.5rem">
		<time class="opacity-60">{date}</time>
		{#if flag === '!'}
			<TriangleAlertIcon class="text-warning inline-block size-4 align-text-bottom" />
		{/if}
		{payee}{#if payee && note}<span class="opacity-50"> · {note}</span>{:else if note}{note}{/if}
		{#if extra}<span class="opacity-50"> · {extra}</span>{/if}
	</div>
	<div class="shrink-0 text-right whitespace-nowrap tabular-nums {amountClass}">
		{amount}
		<span class="font-mono">{currency}</span>
	</div>
</div>
