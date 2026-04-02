<script lang="ts">
	import Toolbar from "$lib/components/Toolbar.svelte";
	import ledgerService from '$lib/services/ledgerService';

	let bql = $state('SELECT account, sum(number) as balance, currency ORDER BY account');
	let columns: string[] = $state([]);
	let rows: any[] = $state([]);
	let error = $state('');

	function runQuery() {
		error = '';
		try {
			const result = ledgerService.query(bql);
			columns = result?.columns ?? [];
			rows = result?.rows ?? [];
		} catch (e: any) {
			columns = [];
			rows = [];
			error = e?.message ?? String(e);
		}
	}
</script>

<main class="flex flex-col flex-1">
	<Toolbar title="Query" />

	<div class="flex flex-col gap-4 p-4">
		<textarea
			class="textarea textarea-bordered w-full font-mono text-sm h-32"
			placeholder="Enter BQL query..."
			bind:value={bql}
			onkeydown={(e) => e.key === 'Enter' && e.ctrlKey && runQuery()}
		></textarea>

		<div class="flex gap-2 items-center">
			<button class="btn btn-primary" onclick={runQuery}>Query</button>
			{#if rows.length > 0}
				<span class="text-sm text-base-content/60">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
			{/if}
		</div>

		{#if error}
			<div class="alert alert-error text-sm">{error}</div>
		{/if}

		{#if columns.length > 0}
			<div class="overflow-x-auto">
				<table class="table table-sm table-zebra w-full">
					<thead>
						<tr>
							{#each columns as col}
								<th>{col}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each rows as row}
							<tr>
								{#each columns as col}
									<td class="font-mono text-xs">{row[col] ?? ''}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</main>
