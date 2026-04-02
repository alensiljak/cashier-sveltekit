<script lang="ts">
	import Toolbar from "$lib/components/Toolbar.svelte";
	import ledgerService from '$lib/services/ledgerService';

	let bql = $state('SELECT account, sum(number) as balance, currency ORDER BY account');
	let columns: string[] = $state([]);
	let rows: any[] = $state([]);
	interface QueryError { message: string; severity: string; line: number; column: number; }
	let errors: QueryError[] = $state([]);

	function runQuery() {
		errors = [];
		try {
            console.log('Running BQL query:', bql);

			const result = ledgerService.query(bql);

            console.log('BQL query result:', result);

			errors = result?.errors ?? [];
			if (errors.length === 0) {
				columns = result?.columns ?? [];
				rows = result?.rows ?? [];
			} else {
				columns = [];
				rows = [];
			}
		} catch (e: any) {
			columns = [];
			rows = [];
			errors = [{ message: e?.message ?? String(e), severity: 'error', line: 0, column: 0 }];
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

		{#if errors.length > 0}
			<div class="border border-error rounded-lg bg-error/10 p-3 flex flex-col gap-1">
				{#each errors as err}
					<div class="text-error text-sm font-mono">
						{#if err.line}<span class="opacity-60">{err.severity} {err.line}:{err.column} — </span>{/if}{err.message}
					</div>
				{/each}
			</div>
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
								{#each columns as _col, i}
									<td class="font-mono">{row[i] ?? ''}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</main>
