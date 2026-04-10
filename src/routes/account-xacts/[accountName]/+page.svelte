<script lang="ts">
	import { page } from '$app/state';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { Posting, Xact } from '$lib/data/model';
	import * as Formatter from '$lib/utils/formatter';

	const cols = $derived(page.data.ledgerColumns as string[]);
	const dateIdx = $derived(cols.indexOf('date'));
	const payeeIdx = $derived(cols.indexOf('payee'));
	const narrationIdx = $derived(cols.indexOf('narration'));
	const numberIdx = $derived(cols.indexOf('number'));
	const currencyIdx = $derived(cols.indexOf('currency'));

	const PAGE_SIZE = 30;
	let visibleCount = $state(PAGE_SIZE);
	let sentinel = $state<HTMLElement | null>(null);

	const allRows = $derived(page.data.ledgerRows as unknown[][]);
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

		<!-- Device transactions -->
		{#if page.data.xacts.length > 0}
		<hr class="hr text-gray-600" />

		<div class="space-y-1 rounded border-l-4 border-amber-500 bg-amber-50 p-2 dark:bg-amber-950/30">
			<p class="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
				Device Transactions
				<span class="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-normal text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">not exported</span>
			</p>

			{#each page.data.xacts as xact: Xact (xact)}
				{@const posting = xact.postings?.find((p: Posting) => p.account === page.data.account.name)}

				<div class="flex flex-row px-2">
					<data class="mr-4">
						{xact.date}
					</data>
					<data class="grow">
						{xact.payee}{xact.payee && xact.note ? ' | ' : ''}{xact.note}
					</data>
					<data class={`${Formatter.getAmountColour(posting?.amount)}`}>
						{Formatter.formatAmount(posting?.amount)}
						{posting?.currency}
					</data>
				</div>
			{/each}
		</div>
		{/if}

		<!-- Double-line separator -->
		<div class="my-2 space-y-0.5">
			<hr class="border-gray-400" />
			<hr class="border-gray-400" />
		</div>

		<!-- Full ledger transactions -->
		<div class="space-y-1">
			<p class="text-sm font-semibold text-gray-600">Ledger</p>

			{#each visibleRows as row}
				<div class="flex flex-row px-2">
					<data class="mr-4 shrink-0">
						{row[dateIdx]}
					</data>
					<data class="grow">
						{row[payeeIdx]}{row[payeeIdx] && row[narrationIdx] ? ' | ' : ''}{row[narrationIdx]}
					</data>
					<data class={`shrink-0 ${Formatter.getAmountColour(row[numberIdx] as number)}`}>
						{Formatter.formatAmount(row[numberIdx] as number)}
						{row[currencyIdx]}
					</data>
				</div>
			{/each}
			<div bind:this={sentinel}></div>
		</div>
	</section>
</article>
