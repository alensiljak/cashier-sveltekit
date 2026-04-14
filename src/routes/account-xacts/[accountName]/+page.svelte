<script lang="ts">
	import { page } from '$app/state';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import type { UnifiedXact } from './+page.js';
	import * as Formatter from '$lib/utils/formatter';

	const PAGE_SIZE = 30;
	let visibleCount = $state(PAGE_SIZE);
	let sentinel = $state<HTMLElement | null>(null);

	const allRows = $derived(page.data.unifiedRows as UnifiedXact[]);
	const visibleRows = $derived(allRows.slice(0, visibleCount));

	$effect(() => {
		if (!sentinel) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting && visibleCount < allRows.length) {
				visibleCount = Math.min(visibleCount + PAGE_SIZE, allRows.length);
			}
		});
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Account Transactions"></Toolbar>

	<section class="h-full space-y-2 overflow-auto p-1">
		<header>
			<p>{page.data.account.getParentName()}</p>
			<div class="flex flex-row text-3xl font-bold">
				<data class="grow">
					{page.data.account.getAccountName()}
				</data>
				<data class={`${Formatter.getAmountColour(page.data.total.quantity)}`}>
					{Formatter.formatAmount(page.data.total.quantity)}
					{page.data.total.currency}
				</data>
			</div>
		</header>

		{#if page.data.hasDeviceXacts}
			<div class="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
				<span class="inline-block h-3 w-1 rounded-sm bg-amber-400"></span>
				<span>Rows with an amber bar are device-only and not yet exported</span>
			</div>
		{/if}

		<!-- Double-line separator -->
		<div class="my-2 space-y-0.5">
			<hr class="border-gray-400" />
			<hr class="border-gray-400" />
		</div>

		<!-- Unified transaction list -->
		<div class="space-y-1">
			{#each visibleRows as row (row)}
				<div
					class="flex flex-row px-2 {row.isDevice
						? 'border-l-2 border-amber-400 bg-amber-50/60 dark:bg-amber-950/25'
						: ''}"
				>
					<data class="mr-4 shrink-0">{row.date}</data>
					<data class="grow">
						{row.payee}{row.payee && row.narration ? ' | ' : ''}{row.narration}
					</data>
					<data class="shrink-0 {Formatter.getAmountColour(row.amount)}">
						{Formatter.formatAmount(row.amount)}
						{row.currency}
					</data>
				</div>
			{/each}
			<div bind:this={sentinel}></div>
		</div>
	</section>
</article>
