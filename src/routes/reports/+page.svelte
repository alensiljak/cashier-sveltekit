<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import fullLedgerService from '$lib/services/fullLedgerService';

	let loading = $state(false);
	let loaded = $state(fullLedgerService.isLoaded);
	let error = $state<string | null>(null);

	async function handleLoad() {
		loading = true;
		error = null;
		try {
			await fullLedgerService.load();
			loaded = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			loaded = false;
		} finally {
			loading = false;
		}
	}
</script>

<article class:cursor-wait={loading}>
	<Toolbar title="Reports" />

	<div class="flex-1 overflow-y-auto px-1">
		<div class="mb-4 flex flex-col gap-2">
			<!-- Status panel -->
			<div
				class="mx-auto mt-4 flex w-350 max-w-[350px] items-center gap-3 rounded-md border bg-base-200 px-4 py-3"
			>
				<span
					class="inline-block h-3 w-3 flex-shrink-0 rounded-full"
					class:bg-green-500={loaded && !loading}
					class:bg-red-500={!loaded && !loading}
					class:bg-yellow-400={loading}
					title={loading ? 'Loading…' : loaded ? 'Ledger loaded' : 'Ledger not loaded'}
				></span>
				<span class="flex-1 text-sm">
					{#if loading}
						Loading…
					{:else if loaded}
						Ledger loaded
					{:else if error}
						Error: {error}
					{:else}
						Ledger not loaded
					{/if}
				</span>
				<button class="btn btn-sm" onclick={handleLoad} disabled={loading}>
					{loading ? 'Loading…' : 'Load'}
				</button>
			</div>

			<!-- Reports -->
			<div class="mx-auto flex w-350 max-w-[350px] flex-col gap-6 px-4 pt-4 sm:px-6">
				<a href="/reports/query" class="btn btn-primary">
					Queries
				</a>
				<a href="/reports/tx-search" class="btn btn-primary">
                    Transaction Search
                </a>
				<a href="/reports/expenses" class="btn btn-primary">
                    Expenses
                </a>
			</div>
		</div>
	</div>
</article>
