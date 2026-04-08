<script lang="ts">
	import Toolbar from "$lib/components/Toolbar.svelte";
	import ledgerService from '$lib/services/ledgerService';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';

	let bql = $state('SELECT account, sum(number) as balance, currency ORDER BY account');

	// Source selection
	let useLiteLedger = $state(true);
	let useFullLedger = $state(false);

	// Lite Ledger results
	let liteLedgerColumns: string[] = $state([]);
	let liteLedgerRows: any[] = $state([]);
	interface QueryError { message: string; severity?: string; line?: number; column?: number; }
	let liteLedgerErrors: QueryError[] = $state([]);

	// Full Ledger results
	let fullLedgerColumns: string[] = $state([]);
	let fullLedgerRows: any[] = $state([]);
	let fullLedgerErrors: QueryError[] = $state([]);

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

		// Ensure at least one source is selected
		if (!useLiteLedger && !useFullLedger) {
			useLiteLedger = true;
		}

		// Run Lite Ledger query
		if (useLiteLedger) {
			liteLedgerErrors = [];
			try {
				const result = ledgerService.query(bql);
				liteLedgerErrors = result?.errors ?? [];
				if (liteLedgerErrors.length === 0) {
					liteLedgerColumns = result?.columns ?? [];
					liteLedgerRows = result?.rows ?? [];
				} else {
					liteLedgerColumns = [];
					liteLedgerRows = [];
				}
			} catch (e: any) {
				liteLedgerColumns = [];
				liteLedgerRows = [];
				liteLedgerErrors = [{ message: e?.message ?? String(e), severity: 'error', line: 0, column: 0 }];
			}
		} else {
			liteLedgerColumns = [];
			liteLedgerRows = [];
			liteLedgerErrors = [];
		}

		// Run Full Ledger query
		if (useFullLedger) {
			fullLedgerErrors = [];
			try {
				await fullLedgerService.ensureLoaded();
				const result = await fullLedgerService.query(bql);
				fullLedgerErrors = (result?.errors ?? []) as QueryError[];
				if (fullLedgerErrors.length === 0) {
					fullLedgerColumns = result?.columns ?? [];
					fullLedgerRows = result?.rows ?? [];
				} else {
					fullLedgerColumns = [];
					fullLedgerRows = [];
				}
			} catch (e: any) {
				fullLedgerColumns = [];
				fullLedgerRows = [];
				fullLedgerErrors = [{ message: e?.message ?? String(e), severity: 'error', line: 0, column: 0 }];
			}
		} else {
			fullLedgerColumns = [];
			fullLedgerRows = [];
			fullLedgerErrors = [];
		}

		isRunning = false;
	}

	// Are we in comparison mode?
	let comparing = $derived(useLiteLedger && useFullLedger);
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
			<!-- Source checkboxes -->
			<label class="label cursor-pointer gap-1">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={useLiteLedger} />
				<span class="label-text">Lite Ledger</span>
			</label>
			<label class="label cursor-pointer gap-1">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={useFullLedger} />
				<span class="label-text">Full Ledger</span>
			</label>

			<button class="btn btn-primary btn-sm" onclick={runQuery} disabled={isRunning}>
				{#if isRunning}
					<span class="loading loading-spinner loading-xs"></span> Running...
				{:else}
					Query
				{/if}
			</button>
		</div>

		{#if comparing}
			<!-- Side-by-side comparison -->
			<div class="grid grid-cols-2 gap-4">
				<!-- Lite Ledger panel -->
				<div class="flex flex-col gap-2">
					<h3 class="font-semibold text-sm">Lite Ledger {liteLedgerRows.length > 0 ? `(${liteLedgerRows.length} rows)` : ''}</h3>
					{@render errorBlock(liteLedgerErrors)}
					{@render resultTable(liteLedgerColumns, liteLedgerRows)}
				</div>
				<!-- Full Ledger panel -->
				<div class="flex flex-col gap-2">
					<h3 class="font-semibold text-sm">Full Ledger {fullLedgerRows.length > 0 ? `(${fullLedgerRows.length} rows)` : ''}</h3>
					{@render errorBlock(fullLedgerErrors)}
					{@render resultTable(fullLedgerColumns, fullLedgerRows)}
				</div>
			</div>
		{:else}
			<!-- Single source output -->
			{#if useLiteLedger}
				{#if liteLedgerRows.length > 0}
					<span class="text-sm text-base-content/60">{liteLedgerRows.length} row{liteLedgerRows.length !== 1 ? 's' : ''}</span>
				{/if}
				{@render errorBlock(liteLedgerErrors)}
				{@render resultTable(liteLedgerColumns, liteLedgerRows)}
			{/if}
			{#if useFullLedger}
				{#if fullLedgerRows.length > 0}
					<span class="text-sm text-base-content/60">{fullLedgerRows.length} row{fullLedgerRows.length !== 1 ? 's' : ''}</span>
				{/if}
				{@render errorBlock(fullLedgerErrors)}
				{@render resultTable(fullLedgerColumns, fullLedgerRows)}
			{/if}
		{/if}
	</div>
</main>

{#snippet errorBlock(errors: QueryError[])}
	{#if errors.length > 0}
		<div class="border border-error rounded-lg bg-error/10 p-3 flex flex-col gap-1">
			{#each errors as err}
				<div class="text-error text-sm font-mono">
					{#if err.line}<span class="opacity-60">{err.severity} {err.line}:{err.column} — </span>{/if}{err.message}
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet resultTable(columns: string[], rows: any[])}
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
{/snippet}