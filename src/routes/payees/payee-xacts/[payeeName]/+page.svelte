<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import { xact as xactStore, xactSpan } from '$lib/data/mainStore';
	import type { Xact } from '$lib/data/model';
	import type { PayeeXactRow } from './+page.ts';

	async function onRowClick(row: PayeeXactRow) {
		xactStore.set(row.xact);
		xactSpan.set(row.span);
		await goto('/xact-actions');
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Payee Transactions">
		{#snippet actions()}
			<HelpButton topic="payee-transactions" />
		{/snippet}
	</Toolbar>

	<section class="min-h-0 flex-1 overflow-y-auto space-y-2 p-1">
		<header>
			<div class="text-2xl font-bold">
				{page.data.payeeName || '(no payee)'}
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

		{#each page.data.xacts as row (row.xact)}
			<div class="border-base-content/10 border-b py-1">
				<JournalXactRow xact={row.xact} onclick={() => onRowClick(row)} />
			</div>
		{/each}
	</section>
</main>
