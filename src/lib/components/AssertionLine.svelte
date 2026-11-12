<script lang="ts">
	import CircleCheckBigIcon from '@lucide/svelte/icons/circle-check-big';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';

	/**
	 * Compact one-line display of a balance assertion: date, check icon, account, and the
	 * asserted balance in the amount column (prefixed with `=`, dimmed, so it doesn't read
	 * as money moving). Sibling of XactSummaryLine; wrapped lines hang-indent the same way.
	 * A rejected assertion turns red, with an X and the balance the book actually holds.
	 */
	interface Props {
		/** Already formatted for display. */
		date: string;
		account: string;
		/** Already formatted for display. */
		amount: string;
		currency?: string | null;
		/** Extra inline content after the account, e.g. a device badge. */
		extra?: string | null;
		/** Set when the assertion failed: the actual balance, already formatted for display. */
		actual?: string;
	}

	let { date, account, amount, currency, extra, actual }: Props = $props();
	const failed = $derived(actual !== undefined);
</script>

<!-- The whole row is dimmed as one unit so it reads as a quiet checkpoint; a failure is not dimmed. -->
<div class="flex min-w-0 grow items-end justify-between gap-2 {failed ? '' : 'opacity-70'}">
	<div class="min-w-0 pl-6" style="text-indent: -1.5rem">
		<time>{date}</time>
		{#if failed}
			<CircleXIcon class="inline-block size-4 align-text-bottom text-error" />
		{:else}
			<CircleCheckBigIcon class="inline-block size-4 align-text-bottom" />
		{/if}
		{account}
		{#if extra}<span class="opacity-70"> · {extra}</span>{/if}
	</div>
	<div class="shrink-0 text-right whitespace-nowrap tabular-nums {failed ? 'text-error' : ''}">
		= {amount}
		<span class="font-mono">{currency}</span>
		{#if failed}
			<div class="text-xs">is {actual} {currency}</div>
		{/if}
	</div>
</div>
