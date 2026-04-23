<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import PeriodSelector, { type Period } from '$lib/components/PeriodSelector.svelte';
	import ExpensesBarChart from '$lib/components/ExpensesBarChart.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '$lib/settings';

	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let chartLabels = $state<string[]>([]);
	let chartValues = $state<number[]>([]);
	let expenseTotal = $derived(chartValues.reduce((sum, v) => sum + v, 0));
	let currentPeriod = $state<Period | null>(null);

	function handleBarClick(account: string) {
		if (!currentPeriod) return;
		const params = new URLSearchParams({
			account,
			dateFrom: currentPeriod.dateFrom,
			dateTo: currentPeriod.dateTo
		});
		goto(`/reports/tx-search?${params}`);
	}

	async function loadExpenses(period: Period) {
		currentPeriod = period;
		isLoading = true;
		error = null;
		await tick();

		try {
			const defaultCurrency = await settings.get<string>(SettingKeys.currency);
			await fullLedgerService.ensureLoaded();

			const bql = `SELECT account, NUMBER(CONVERT(units(position), "${defaultCurrency}")) AS number WHERE account ~ "^Expenses" AND date >= ${period.dateFrom} AND date <= ${period.dateTo}`;
			const result = await fullLedgerService.query(bql);

			if (result?.errors?.length) {
				error = (result.errors as any[]).map((e) => e.message).join('; ');
				chartLabels = [];
				chartValues = [];
				return;
			}

			const columns = result?.columns ?? [];
			const rows = result?.rows ?? [];

			const accountIdx = columns.indexOf('account');
			const numberIdx = columns.indexOf('number');

			if (accountIdx === -1 || numberIdx === -1) {
				error = 'Unexpected query result columns.';
				return;
			}

			// Aggregate amounts per account
			const totals = new Map<string, number>();
			for (const row of rows as any[]) {
				const account = String(row[accountIdx] ?? '');
				const amount = parseFloat(String(row[numberIdx] ?? '0')) || 0;
				totals.set(account, (totals.get(account) ?? 0) + amount);
			}

			// Sort descending by amount
			const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);

			chartLabels = sorted.map(([acc]) => acc);
			chartValues = sorted.map(([, val]) => val);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}
</script>

<article class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Expenses" />

	<!-- Period selector -->
	<div class="flex items-center gap-3 px-4 pt-3 pb-2">
		<span class="text-sm font-medium text-base-content/60">Period:</span>
		<PeriodSelector onselect={loadExpenses} />
	</div>

	<!-- Chart area -->
	<section class="grow overflow-y-auto px-4 py-2">
		{#if isLoading}
			<div class="flex justify-center py-12">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if error}
			<div class="rounded-lg border border-error bg-error/10 p-3 text-error text-sm font-mono">
				{error}
			</div>
		{:else if chartLabels.length === 0}
			<div class="py-12 text-center text-base-content/50 text-sm">No expense data for this period.</div>
		{:else}
			<ExpensesBarChart labels={chartLabels} values={chartValues} onclick={handleBarClick} />
		{/if}
	</section>

	<!-- Total -->
	{#if chartValues.length > 0}
		<div class="flex justify-end px-4 py-2 border-t border-base-300 text-sm font-medium">
			<span class="text-base-content/60 mr-2">Total:</span>
			<span>{expenseTotal.toFixed(2)}</span>
		</div>
	{/if}
</article>
