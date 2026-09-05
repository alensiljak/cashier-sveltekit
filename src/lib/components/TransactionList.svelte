<script lang="ts">
	import { untrack } from 'svelte';
	import type { UnifiedXact } from '$lib/utils/unifiedXacts';
	import * as Formatter from '$lib/utils/formatter';

	interface Props {
		rows: UnifiedXact[];
		onRowClick: (row: UnifiedXact) => void;
		/** Show each row's account (useful when rows span multiple accounts, e.g. Payee Transactions). */
		showAccount?: boolean;
		pageSize?: number;
		/** Row to scroll to and highlight on mount, e.g. arriving from a Xact Details account link. */
		highlightRow?: UnifiedXact;
	}

	let { rows, onRowClick, showAccount = false, pageSize = 30, highlightRow }: Props = $props();

	let visibleCount = $state(untrack(() => pageSize));
	let sentinel = $state<HTMLElement | null>(null);

	// Reset progressive loading whenever the row set changes (e.g. a different payee/account).
	// If a highlight target sits further down the list than the initial page, reveal up to it.
	$effect(() => {
		const highlightIndex = highlightRow ? rows.indexOf(highlightRow) : -1;
		visibleCount = highlightIndex >= 0 ? Math.max(pageSize, highlightIndex + 1) : pageSize;
	});

	const visibleRows = $derived(rows.slice(0, visibleCount));

	function scrollToHighlight(node: HTMLElement, isTarget: boolean) {
		if (isTarget) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
		return {
			update(newIsTarget: boolean) {
				if (newIsTarget) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
			}
		};
	}

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
				: ''} {row === highlightRow ? 'highlight-target' : ''}"
			onclick={() => onRowClick(row)}
			onkeypress={() => onRowClick(row)}
			use:scrollToHighlight={row === highlightRow}
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

<style>
	@keyframes highlight-fade {
		0%,
		20% {
			box-shadow: inset 0 0 0 2px rgba(250, 204, 21, 0.9);
		}
		100% {
			box-shadow: inset 0 0 0 2px transparent;
		}
	}

	.highlight-target {
		animation: highlight-fade 2.5s ease-out;
	}
</style>
