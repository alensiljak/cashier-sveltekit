<script lang="ts">
	import Toolbar from "$lib/components/Toolbar.svelte";
	import fullLedgerService from '$lib/services/ledgerWorkerClient';

	let bql = $state('SELECT account, sum(number) as balance, currency ORDER BY account');

	interface QueryError { message: string; severity?: string; line?: number; column?: number; }
	let columns: string[] = $state([]);
	let rows: any[] = $state([]);
	let errors: QueryError[] = $state([]);

	let isRunning = $state(false);

	function formatCell(value: any): string {
		if (value == null) return '';
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		}
		// Structured objects (e.g. positions from sum(position))
		try {
			return JSON.stringify(value, null, 1);
		} catch {
			return String(value);
		}
	}

	async function runQuery() {
		isRunning = true;
		errors = [];

		try {
			await fullLedgerService.ensureLoaded();
			const result = await fullLedgerService.query(bql);
			errors = (result?.errors ?? []) as QueryError[];
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

		isRunning = false;
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

		<div class="flex gap-2 items-center flex-wrap">
			<button class="btn btn-primary btn-sm" onclick={runQuery} disabled={isRunning}>
				{#if isRunning}
					<span class="loading loading-spinner loading-xs"></span> Running...
				{:else}
					Query
				{/if}
			</button>
		</div>

		{#if rows.length > 0}
			<span class="text-sm text-base-content/60">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
		{/if}
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
									<td class="font-mono text-xs whitespace-pre-wrap">{formatCell(row[i])}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</main>
