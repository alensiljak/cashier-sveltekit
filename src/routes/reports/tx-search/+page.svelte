<script lang="ts">
	import { tick, onMount } from 'svelte';
	import { page } from '$app/state';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import AccordionSection from '$lib/components/AccordionSection.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';

	// State
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let hasSearched = $state(false);
	let filtersExpanded = $state(true);

	// Results
	let columns = $state<string[]>([]);
	let rows = $state<any[][]>([]);
	let queryErrors = $state<{ message: string; severity?: string; line?: number; column?: number }[]>([]);

	// Filter state
	let dateFrom = $state('');
	let dateTo = $state('');

	onMount(() => {
		const params = page.url.searchParams;
		const paramAccount = params.get('account');
		const paramDateFrom = params.get('dateFrom');
		const paramDateTo = params.get('dateTo');
		if (paramAccount || paramDateFrom || paramDateTo) {
			if (paramAccount) account = paramAccount;
			if (paramDateFrom) dateFrom = paramDateFrom;
			if (paramDateTo) dateTo = paramDateTo;
			filtersExpanded = false;
			search();
		}
	});
	let payeeNarration = $state('');
	let account = $state('');
	let amountOp = $state<'>' | '<' | '='>('=');
	let amountValue = $state('');

	function buildQuery(): string {
		const conditions: string[] = [];

		if (dateFrom) conditions.push(`date >= ${dateFrom}`);
		if (dateTo) conditions.push(`date <= ${dateTo}`);
		if (payeeNarration) {
			const esc = payeeNarration.replace(/"/g, '\\"');
			conditions.push(`(payee ~ "${esc}" OR narration ~ "${esc}")`);
		}
		if (account) {
			const esc = account.replace(/"/g, '\\"');
			conditions.push(`account ~ "${esc}"`);
		}
		if (amountValue !== '') {
			const val = parseFloat(amountValue);
			if (!isNaN(val)) conditions.push(`number ${amountOp} ${val}`);
		}

		const where = conditions.length > 0
            ? ` WHERE ${conditions.join(' AND ')}` : '';
		return `SELECT date, payee, narration, account, number, currency \
${where} ORDER BY date DESC`;
	}

	let generatedQuery = $derived(buildQuery());

	function clearFilters() {
		dateFrom = '';
		dateTo = '';
		payeeNarration = '';
		account = '';
		amountOp = '=';
		amountValue = '';
		hasSearched = false;
		columns = [];
		rows = [];
		queryErrors = [];
	}

	async function search() {
		isLoading = true;
		error = null;
		queryErrors = [];
		await tick(); // yield to browser so loading state renders before synchronous query
		try {
			await fullLedgerService.ensureLoaded();
			const result = await fullLedgerService.query(generatedQuery);
			queryErrors = (result?.errors ?? []) as typeof queryErrors;
			if (queryErrors.length === 0) {
				columns = result?.columns ?? [];
				rows = (result?.rows ?? []) as any[][];
			} else {
				columns = [];
				rows = [];
			}
			hasSearched = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	function formatCell(value: any): string {
		if (value == null) return '';
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		}
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}

	// Index of 'number' column for colour coding
	let numberColIdx = $derived(columns.indexOf('number'));

	// Detect which columns are numeric based on the first row
	let numericCols = $derived(
		columns.map((_col, i) => {
			if (rows.length === 0) return false;
			const val = rows[0][i];
			return typeof val === 'number' || (typeof val === 'string' && val !== '' && !isNaN(Number(val)));
		})
	);
</script>

<article class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Transaction Search" />

	<!-- Filter Panel -->
	<div class="px-2 pt-2">
		<AccordionSection
			title="Filters"
			badge={hasSearched ? rows.length : undefined}
			expanded={filtersExpanded}
			onToggle={() => (filtersExpanded = !filtersExpanded)}
		>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<!-- Date Range -->
				<div class="flex flex-col gap-1">
					<label for="date-from" class="label py-0 text-xs font-semibold text-base-content/60"
						>Date From</label
					>
					<input
						id="date-from"
						type="date"
						class="input input-bordered input-sm w-full"
						bind:value={dateFrom}
					/>
				</div>
				<div class="flex flex-col gap-1">
					<label for="date-to" class="label py-0 text-xs font-semibold text-base-content/60"
						>Date To</label
					>
					<input
						id="date-to"
						type="date"
						class="input input-bordered input-sm w-full"
						bind:value={dateTo}
					/>
				</div>

				<!-- Payee / Narration -->
				<div class="flex flex-col gap-1 sm:col-span-2">
					<label
						for="payee-narration"
						class="label py-0 text-xs font-semibold text-base-content/60">Payee / Narration</label
					>
					<input
						id="payee-narration"
						type="text"
						class="input input-bordered input-sm w-full"
						placeholder="regex or text…"
						bind:value={payeeNarration}
					/>
				</div>

				<!-- Account -->
				<div class="flex flex-col gap-1 sm:col-span-2">
					<label for="account" class="label py-0 text-xs font-semibold text-base-content/60"
						>Account</label
					>
					<input
						id="account"
						type="text"
						class="input input-bordered input-sm w-full"
						placeholder="e.g. Expenses:Food"
						bind:value={account}
					/>
				</div>

				<!-- Amount -->
				<div class="flex flex-col gap-1 sm:col-span-2">
					<label for="amount-value" class="label py-0 text-xs font-semibold text-base-content/60"
						>Amount</label
					>
					<div class="flex gap-2">
						<select class="select select-bordered select-sm w-20" bind:value={amountOp}>
							<option value="=">=</option>
							<option value=">">&gt;</option>
							<option value="<">&lt;</option>
						</select>
						<input
							id="amount-value"
							type="number"
							class="input input-bordered input-sm flex-1"
							placeholder="0.00"
							step="0.01"
							bind:value={amountValue}
						/>
					</div>
				</div>

				<!-- Generated query preview -->
				<div class="sm:col-span-2">
					<code class="block rounded bg-base-200 px-2 py-1 text-xs text-base-content/60 break-all">
						{generatedQuery}
					</code>
				</div>

				<!-- Actions -->
				<div class="flex items-center gap-2 sm:col-span-2">
					<button class="btn btn-sm btn-outline" onclick={clearFilters}>Clear</button>
					<button class="btn btn-sm btn-primary" onclick={search} disabled={isLoading}>
						{#if isLoading}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
						Search
					</button>
					{#if error}
						<span class="text-sm text-error">{error}</span>
					{/if}
				</div>
			</div>
		</AccordionSection>
	</div>

	<!-- Results -->
	<section class="grow overflow-y-auto touch-pan-y px-2 py-2">
		{#if isLoading}
			<div class="flex justify-center py-8">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if queryErrors.length > 0}
			<div class="rounded-lg border border-error bg-error/10 p-3 flex flex-col gap-1">
				{#each queryErrors as err}
					<div class="text-error text-sm font-mono">
						{#if err.line}<span class="opacity-60">{err.severity} {err.line}:{err.column} — </span>{/if}{err.message}
					</div>
				{/each}
			</div>
		{:else if !hasSearched}
			<div class="py-8 text-center text-base-content/50 text-sm">
				Set filters and click Search.
			</div>
		{:else if rows.length === 0}
			<div class="py-8 text-center text-base-content/50 text-sm">No results.</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="table table-xs w-full [&_tbody_tr:nth-child(even)]:bg-base-200 [&_tbody_tr:nth-child(odd)]:bg-base-100">
					<thead>
						<tr>
							{#each columns as col, i}
								<th class:text-right={numericCols[i]}>{col}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each rows as row}
							<tr>
								{#each columns as _col, i}
									<td
										class="font-mono whitespace-nowrap"
										class:text-right={numericCols[i]}
										class:text-red-400={i === numberColIdx && parseFloat(row[i]) < 0}
										class:text-green-500={i === numberColIdx && parseFloat(row[i]) > 0}
									>
										{formatCell(row[i])}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</article>
