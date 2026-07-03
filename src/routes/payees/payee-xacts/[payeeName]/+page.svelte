<script lang="ts">
	import { page } from '$app/state';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import TransactionList from '$lib/components/TransactionList.svelte';
	import { openXactDetails } from '$lib/utils/unifiedXacts';
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

		<TransactionList rows={page.data.unifiedRows} onRowClick={openXactDetails} showAccount />
	</section>
</main>
