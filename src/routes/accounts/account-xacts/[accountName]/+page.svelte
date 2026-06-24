<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import type { UnifiedXact } from './+page.js';
	import * as Formatter from '$lib/utils/formatter';
	import { ScaleIcon } from '@lucide/svelte';
	import { xact, xactSpan } from '$lib/data/mainStore';

	const PAGE_SIZE = 30;
	let visibleCount = $state(PAGE_SIZE);
	let sentinel = $state<HTMLElement | null>(null);

	async function onRowClick(row: UnifiedXact) {
		if (!row.isDevice || !row.xact || !row.span) return;
		xact.set(row.xact);
		xactSpan.set(row.span);
		await goto('/xact-actions');
	}

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
	<Toolbar title="Account Transactions">
		{#snippet menuItems()}
			<ToolbarMenuItem
				Icon={ScaleIcon}
				text="Balance Adjustment"
				onclick={() => goto(`/accounts/bal-adj?account=${encodeURIComponent(page.data.account.name)}`)}
			/>
		{/snippet}
	</Toolbar>

	<section class="min-h-0 flex-1 overflow-y-auto space-y-2 p-1">
		<header>
			<p>{page.data.account.getParentName()}</p>
			<div class="flex flex-row text-2xl font-bold">
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
				<span>Local records</span>
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
						? 'cursor-pointer border-l-2 border-amber-400 bg-amber-50/60 dark:bg-amber-950/25'
						: ''}"
					onclick={() => onRowClick(row)}
					onkeypress={() => onRowClick(row)}
					{...row.isDevice ? { role: 'button', tabindex: 0 } : {}}
				>
					<data class="mr-4 shrink-0">{row.date}</data>
					<data class="grow">
						{row.payee}{#if row.payee && row.narration}<span class="opacity-50"> · {row.narration}</span>{:else if row.narration}{row.narration}{/if}
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
