<script lang="ts">
	import CircleCheckBigIcon from '@lucide/svelte/icons/circle-check-big';

	/**
	 * Compact one-line display of a balance assertion: date, check icon, account, and the
	 * asserted balance in the amount column (prefixed with `=`, dimmed, so it doesn't read
	 * as money moving). Sibling of XactSummaryLine; wrapped lines hang-indent the same way.
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
	}

	let { date, account, amount, currency, extra }: Props = $props();
</script>

<div class="flex min-w-0 grow items-end justify-between gap-2">
	<div class="min-w-0 pl-6" style="text-indent: -1.5rem">
		<time class="opacity-60">{date}</time>
		<CircleCheckBigIcon class="inline-block size-4 align-text-bottom opacity-70" />
		{account}
		{#if extra}<span class="opacity-50"> · {extra}</span>{/if}
	</div>
	<div class="shrink-0 text-right whitespace-nowrap tabular-nums opacity-70">
		= {amount}
		<span class="font-mono">{currency}</span>
	</div>
</div>
