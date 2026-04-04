<script lang="ts">
	import Toolbar from "$lib/components/Toolbar.svelte";
	import ledgerService from '$lib/services/ledgerService';
	import { loadFileMap } from '$lib/sync/sync-fs';
	import { queryMultiFile, ensureInitialized } from '$lib/services/rustledger';

	let bql = $state('SELECT account, sum(number) as balance, currency ORDER BY account');

	// Source selection
	let useOpfs = $state(true);
	let useFilesystem = $state(false);

	// OPFS results
	let opfsColumns: string[] = $state([]);
	let opfsRows: any[] = $state([]);
	interface QueryError { message: string; severity?: string; line?: number; column?: number; }
	let opfsErrors: QueryError[] = $state([]);

	// Filesystem results
	let fsColumns: string[] = $state([]);
	let fsRows: any[] = $state([]);
	let fsErrors: any[] = $state([]);

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
		if (!useOpfs && !useFilesystem) {
			useOpfs = true;
		}

		// Run OPFS query
		if (useOpfs) {
			opfsErrors = [];
			try {
				const result = ledgerService.query(bql);
				opfsErrors = result?.errors ?? [];
				if (opfsErrors.length === 0) {
					opfsColumns = result?.columns ?? [];
					opfsRows = result?.rows ?? [];
				} else {
					opfsColumns = [];
					opfsRows = [];
				}
			} catch (e: any) {
				opfsColumns = [];
				opfsRows = [];
				opfsErrors = [{ message: e?.message ?? String(e), severity: 'error', line: 0, column: 0 }];
			}
		} else {
			opfsColumns = [];
			opfsRows = [];
			opfsErrors = [];
		}

		// Run Filesystem query
		if (useFilesystem) {
			fsErrors = [];
			try {
				await ensureInitialized();
				const { fileMap, mainFileName } = await loadFileMap();
				const result = queryMultiFile(fileMap, mainFileName, bql);
				fsErrors = result?.errors ?? [];
				if (fsErrors.length === 0) {
					fsColumns = result?.columns ?? [];
					fsRows = result?.rows ?? [];
				} else {
					fsColumns = [];
					fsRows = [];
				}
			} catch (e: any) {
				fsColumns = [];
				fsRows = [];
				fsErrors = [{ message: e?.message ?? String(e), severity: 'error', line: 0, column: 0 }];
			}
		} else {
			fsColumns = [];
			fsRows = [];
			fsErrors = [];
		}

		isRunning = false;
	}

	// Are we in comparison mode?
	let comparing = $derived(useOpfs && useFilesystem);
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
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={useOpfs} />
				<span class="label-text">OPFS</span>
			</label>
			<label class="label cursor-pointer gap-1">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={useFilesystem} />
				<span class="label-text">Filesystem</span>
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
				<!-- OPFS panel -->
				<div class="flex flex-col gap-2">
					<h3 class="font-semibold text-sm">OPFS {opfsRows.length > 0 ? `(${opfsRows.length} rows)` : ''}</h3>
					{@render errorBlock(opfsErrors)}
					{@render resultTable(opfsColumns, opfsRows)}
				</div>
				<!-- Filesystem panel -->
				<div class="flex flex-col gap-2">
					<h3 class="font-semibold text-sm">Filesystem {fsRows.length > 0 ? `(${fsRows.length} rows)` : ''}</h3>
					{@render errorBlock(fsErrors)}
					{@render resultTable(fsColumns, fsRows)}
				</div>
			</div>
		{:else}
			<!-- Single source output -->
			{#if useOpfs}
				{#if opfsRows.length > 0}
					<span class="text-sm text-base-content/60">{opfsRows.length} row{opfsRows.length !== 1 ? 's' : ''}</span>
				{/if}
				{@render errorBlock(opfsErrors)}
				{@render resultTable(opfsColumns, opfsRows)}
			{/if}
			{#if useFilesystem}
				{#if fsRows.length > 0}
					<span class="text-sm text-base-content/60">{fsRows.length} row{fsRows.length !== 1 ? 's' : ''}</span>
				{/if}
				{@render errorBlock(fsErrors)}
				{@render resultTable(fsColumns, fsRows)}
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