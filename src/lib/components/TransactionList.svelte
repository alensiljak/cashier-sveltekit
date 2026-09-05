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

	function findScrollParent(node: HTMLElement): HTMLElement | null {
		let el = node.parentElement;
		while (el) {
			if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) {
				return el;
			}
			el = el.parentElement;
		}
		return null;
	}

	// Native `scrollIntoView({behavior: 'smooth'})` takes longer the farther the
	// target is, which looks like the list is scrolling through lots of
	// transactions when the target is far down. Animate over a fixed short
	// duration instead so it's always quick, however long the list is.
	function scrollIntoViewFast(node: HTMLElement, duration = 300) {
		const scrollParent = findScrollParent(node);
		if (!scrollParent) {
			node.scrollIntoView({ block: 'center', behavior: 'instant' });
			return;
		}

		const parentRect = scrollParent.getBoundingClientRect();
		const nodeRect = node.getBoundingClientRect();
		const start = scrollParent.scrollTop;
		const offset = nodeRect.top - parentRect.top;
		const target = start + offset - (parentRect.height / 2 - nodeRect.height / 2);
		const maxScroll = scrollParent.scrollHeight - scrollParent.clientHeight;
		const end = Math.max(0, Math.min(target, maxScroll));
		const change = end - start;
		if (Math.abs(change) < 1) return;

		const startTime = performance.now();
		function step(now: number) {
			const t = Math.min((now - startTime) / duration, 1);
			const eased = 1 - Math.pow(1 - t, 3);
			scrollParent!.scrollTop = start + change * eased;
			if (t < 1) requestAnimationFrame(step);
		}
		requestAnimationFrame(step);
	}

	function scrollToHighlight(node: HTMLElement, isTarget: boolean) {
		if (isTarget) scrollIntoViewFast(node);
		return {
			update(newIsTarget: boolean) {
				if (newIsTarget) scrollIntoViewFast(node);
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
			box-shadow: inset 0 0 0 1px rgba(250, 204, 21, 0.35);
		}
	}

	.highlight-target {
		animation: highlight-fade 2.5s ease-out forwards;
	}
</style>
