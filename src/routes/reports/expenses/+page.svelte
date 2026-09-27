<script lang="ts">
	import { tick } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { ChartBar, ChartPie, Funnel, FunnelX, ListFilter } from '@lucide/svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import TimeRangeSelector, {
		type TimeRange,
		type TimeRangeState
	} from '$lib/components/TimeRangeSelector.svelte';
	import ExpensesBarChart from '$lib/components/ExpensesBarChart.svelte';
	import ExpensesDonutChart from '$lib/components/ExpensesDonutChart.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '$lib/settings';
	import HelpButton from '$lib/help/HelpButton.svelte';

	type ChartType = 'bar' | 'donut';
	let chartType = $state<ChartType>('bar');
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	// Raw data from the ledger query (all expense accounts for the period)
	let rawLabels = $state<string[]>([]);
	let rawValues = $state<number[]>([]);

	// Filter state: hiddenAccounts persisted; filterEnabled is session-only,
	// defaulting to true whenever hidden accounts are configured.
	let hiddenAccounts = $state<string[]>([]);
	let filterEnabled = $state(false);
	let filterSettingsLoaded = false;

	let currentPeriod = $state<TimeRange | null>(null);

	// The URL is the source of truth for which period is showing, read once on load:
	// - ?period=&anchor= identifies an exact period (e.g. "month" + "2025-11-15") — used both
	//   for external deep-links (e.g. from the Expense Trend report's "Other" bucket, which
	//   points at one specific month) and for this page's own bookkeeping, written via
	//   replaceState on every selection so the Back button restores it exactly rather than
	//   always landing back on the hardcoded default. Being an absolute date, it stays
	//   correct however long the link sits around, unlike a "steps back from today" offset.
	// - ?dateFrom=&dateTo= (no ?period=) seeds the Custom chip, the one shape an anchor can't
	//   express (an arbitrary two-date range).
	// With none of these present (report opened fresh from the nav), TimeRangeSelector's own
	// default applies.
	const urlDateFrom = page.url.searchParams.get('dateFrom');
	const urlDateTo = page.url.searchParams.get('dateTo');
	const urlPeriod = page.url.searchParams.get('period');
	const urlAnchor = page.url.searchParams.get('anchor');
	const isLinked = !!(urlDateFrom && urlDateTo);
	const initialChip = isLinked ? 'custom' : (urlPeriod ?? 'month');
	const initialAnchor = urlAnchor ?? undefined;

	// Visible data: apply filter only when enabled AND there is something to hide
	const chartLabels = $derived.by(() => {
		if (!filterEnabled || hiddenAccounts.length === 0) return rawLabels;
		const hidden = new Set(hiddenAccounts);
		return rawLabels.filter((l) => !hidden.has(l));
	});

	const chartValues = $derived.by(() => {
		if (!filterEnabled || hiddenAccounts.length === 0) return rawValues;
		const hidden = new Set(hiddenAccounts);
		return rawLabels.flatMap((l, i) => (hidden.has(l) ? [] : [rawValues[i]]));
	});

	const expenseTotal = $derived(chartValues.reduce((sum, v) => sum + v, 0));

	function handleBarClick(account: string) {
		if (!currentPeriod) return;
		const params = new URLSearchParams({
			account,
			dateFrom: currentPeriod.dateFrom,
			dateTo: currentPeriod.dateTo
		});
		goto(`/reports/tx-search?${params}`);
	}

	async function loadExpenses(period: TimeRange, state: TimeRangeState) {
		currentPeriod = period;

		// Keep the URL in sync with the current selection (replacing, not pushing, so
		// stepping through periods doesn't spam browser history) so a later Back navigation
		// restores this exact period instead of the component's hardcoded default.
		const params =
			state.chip === 'custom'
				? new URLSearchParams({ dateFrom: period.dateFrom, dateTo: period.dateTo })
				: new URLSearchParams({ period: state.chip, anchor: state.anchor });
		replaceState(`?${params}`, {});

		isLoading = true;
		error = null;
		await tick();

		try {
			// Load hidden accounts once per page lifetime so changes from the
			// filter page are picked up on first period load after returning.
			if (!filterSettingsLoaded) {
				filterSettingsLoaded = true;
				hiddenAccounts = (await settings.get<string[]>(SettingKeys.expensesHiddenAccounts)) ?? [];
				// Default: filter is ON whenever there is something to hide.
				filterEnabled = hiddenAccounts.length > 0;
			}


			const defaultCurrency = await settings.get<string>(SettingKeys.currency);
			await fullLedgerService.ensureLoaded();

			const bql = `SELECT account, NUMBER(CONVERT(units(position), "${defaultCurrency}")) AS number WHERE account ~ "^Expenses" AND date >= ${period.dateFrom} AND date <= ${period.dateTo}`;
			const result = await fullLedgerService.query(bql);

			if (result?.errors?.length) {
				error = (result.errors as any[]).map((e) => e.message).join('; ');
				rawLabels = [];
				rawValues = [];
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

			rawLabels = sorted.map(([acc]) => acc);
			rawValues = sorted.map(([, val]) => val);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	function toggleFilter() {
		filterEnabled = !filterEnabled;
	}
</script>

<main class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Expense Categories">
		{#snippet actions()}
			<!-- Filter toggle: always visible; icon shows what clicking will do -->
			<button
				class="btn btn-ghost btn-sm btn-square"
				onclick={toggleFilter}
				title={filterEnabled ? 'Disable filter' : 'Enable filter'}
			>
				{#if filterEnabled}
					<FunnelX size={18} />
				{:else}
					<Funnel size={18} class="opacity-50" />
				{/if}
			</button>
			<!-- Open filter settings -->
			<button
				class="btn btn-ghost btn-sm btn-square"
				onclick={() => goto('/reports/expenses/filter')}
				title="Edit expense filter"
			>
				<ListFilter size={18} />
			</button>
			<HelpButton topic="report-expenses" />
		{/snippet}
	</Toolbar>

	<!-- Time range selector + chart type toggle -->
	<div class="flex items-start gap-3 border-b border-base-300 px-4 py-3">
		<TimeRangeSelector
			onselect={loadExpenses}
			initial={initialChip}
			{initialAnchor}
			initialCustomFrom={urlDateFrom ?? undefined}
			initialCustomTo={urlDateTo ?? undefined}
		/>
		<div class="ml-auto flex gap-1">
			<button
				class="btn btn-ghost btn-sm btn-square"
				class:bg-base-200={chartType === 'bar'}
				onclick={() => (chartType = 'bar')}
				title="Bar chart"
			>
				<ChartBar size={16} />
			</button>
			<button
				class="btn btn-ghost btn-sm btn-square"
				class:bg-base-200={chartType === 'donut'}
				onclick={() => (chartType = 'donut')}
				title="Donut chart"
			>
				<ChartPie size={16} />
			</button>
		</div>
	</div>

	<!-- Chart area -->
	<section class="grow overflow-y-auto touch-pan-y px-4 py-2">
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
		{:else if chartType === 'bar'}
			<ExpensesBarChart labels={chartLabels} values={chartValues} onclick={handleBarClick} />
		{:else}
			<ExpensesDonutChart labels={chartLabels} values={chartValues} onclick={handleBarClick} />
		{/if}
	</section>

	<!-- Total -->
	{#if chartValues.length > 0}
		<div class="flex items-center justify-end gap-2 px-4 py-2 border-t border-base-300 text-sm font-medium">
			{#if filterEnabled && hiddenAccounts.length > 0}
				<span class="text-xs text-primary opacity-70">filtered</span>
			{/if}
			<span class="text-base-content/60">Total:</span>
			<span>{expenseTotal.toFixed(2)}</span>
		</div>
	{/if}
</main>
