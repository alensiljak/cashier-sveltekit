<script lang="ts">
	import type { UnifiedXact } from '$lib/utils/unifiedXacts';
	import * as Formatter from '$lib/utils/formatter';

	interface Props {
		rows: UnifiedXact[];
		onRowClick: (row: UnifiedXact) => void;
		/** Show each row's account (useful when rows span multiple accounts, e.g. Payee Transactions). */
		showAccount?: boolean;
		pageSize?: number;
	}

	let { rows, onRowClick, showAccount = false, pageSize = 30 }: Props = $props();

	let visibleCount = $state(pageSize);
	let sentinel = $state<HTMLElement | null>(null);

	// Reset progressive loading whenever the row set changes (e.g. a different payee/account).
	$effect(() => {
		void rows;
		visibleCount = pageSize;
	});

	const visibleRows = $derived(rows.slice(0, visibleCount));

	$effect(() => {
		if (!sentinel) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting && visibleCount < rows.length) {
				visibleCount = Math.min(visibleCount + pageSize, rows.length);
			}
		});
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
</script>

<div class="space-y-1">
	{#each visibleRows as row (row)}
		<div
			class="flex flex-row px-2 cursor-pointer {row.isDevice
				? 'border-l-2 border-amber-400 bg-amber-50/60 dark:bg-amber-950/25'
				: ''}"
			onclick={() => onRowClick(row)}
			onkeypress={() => onRowClick(row)}
			role="button"
			tabindex="0"
		>
			<data class="mr-4 shrink-0">{row.date}</data>
			<data class="grow">
				{row.payee}{#if row.payee && row.narration}<span class="opacity-50"> · {row.narration}</span
					>{:else if row.narration}{row.narration}{/if}
				{#if showAccount && row.account}<span class="opacity-50"> · {row.account}</span>{/if}
			</data>
			<data class="shrink-0 {Formatter.getAmountColour(row.amount)}">
				{Formatter.formatAmount(row.amount)}
				{row.currency}
			</data>
		</div>
	{/each}
	{#if rows.length === 0}
		<div class="py-8 text-center text-base-content/50 text-sm">No transactions.</div>
	{/if}
	<div bind:this={sentinel}></div>
</div>
