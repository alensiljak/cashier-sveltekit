<script lang="ts">
	import { onMount } from 'svelte';
	import { tick } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import AccordionSection from '$lib/components/AccordionSection.svelte';
	import IncomeExpenseChart from '$lib/components/IncomeExpenseChart.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '$lib/settings';

	interface DayEntry {
		date: string;
		label: string;
		amount: number;
	}

	interface MonthDetail {
		key: string;
		label: string;
		total: number;
		days: DayEntry[];
		isOutlier: boolean;
	}

	const currentYear = new Date().getFullYear();
	const availableYears = Array.from({ length: 10 }, (_, i) => currentYear - i);

	let selectedPeriod = $state('last12');
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let months = $state<string[]>([]);
	let incomeData = $state<number[]>([]);
	let expensesData = $state<number[]>([]);
	let incomeMonths = $state<MonthDetail[]>([]);
	let expenseMonths = $state<MonthDetail[]>([]);
	let incomeExpanded = $state(false);
	let expensesExpanded = $state(false);

	let maxIncome = $derived(incomeData.reduce((m, v) => Math.max(m, v), 1));
	let maxExpenses = $derived(expensesData.reduce((m, v) => Math.max(m, v), 1));
	let incomeTotal = $derived(incomeData.reduce((s, v) => s + v, 0));
	let expensesTotal = $derived(expensesData.reduce((s, v) => s + v, 0));

	function getLast12Months() {
		const now = new Date();
		const result: { key: string; label: string }[] = [];
		for (let i = 11; i >= 0; i--) {
			const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
			const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
			const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
			result.push({ key, label });
		}
		return result;
	}

	function getYearMonths(year: number) {
		const result: { key: string; label: string }[] = [];
		for (let m = 0; m < 12; m++) {
			const d = new Date(year, m, 1);
			const key = `${year}-${String(m + 1).padStart(2, '0')}`;
			const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
			result.push({ key, label });
		}
		return result;
	}

	function getMonthList() {
		if (selectedPeriod === 'last12') return getLast12Months();
		return getYearMonths(parseInt(selectedPeriod));
	}

	function lastDayOfMonth(yearMonth: string): string {
		const [y, m] = yearMonth.split('-').map(Number);
		const d = new Date(y, m, 0);
		return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	function toDateStr(raw: unknown): string {
		if (!raw) return '';
		const s = String(raw);
		if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
		const d = new Date(s);
		return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
	}

	function markOutliers(items: MonthDetail[]): MonthDetail[] {
		const vals = items.filter((m) => m.total > 0).map((m) => m.total);
		if (vals.length < 3) return items;
		const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
		const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
		const threshold = 1.5 * std;
		return items.map((m) => ({ ...m, isOutlier: m.total > 0 && Math.abs(m.total - mean) > threshold }));
	}

	function txSearchUrl(accountPattern: string, monthKey?: string, singleDate?: string): string {
		const params = new URLSearchParams({ account: accountPattern });
		if (singleDate) {
			params.set('dateFrom', singleDate);
			params.set('dateTo', singleDate);
		} else if (monthKey) {
			params.set('dateFrom', monthKey + '-01');
			params.set('dateTo', lastDayOfMonth(monthKey));
		}
		return `/reports/tx-search?${params}`;
	}

	async function loadData() {
		isLoading = true;
		error = null;
		await tick();

		try {
			const currency = await settings.get<string>(SettingKeys.currency);
			await fullLedgerService.ensureLoaded();

			const monthList = getMonthList();
			const dateFrom = monthList[0].key + '-01';
			const dateTo =
				selectedPeriod === 'last12'
					? new Date().toISOString().slice(0, 10)
					: lastDayOfMonth(monthList[11].key);

			const bql = `SELECT date, account, NUMBER(CONVERT(units(position), '${currency}')) AS number, currency WHERE (account ~ "^Income" OR account ~ "^Expenses") AND date >= ${dateFrom} AND date <= ${dateTo}`;
			const result = await fullLedgerService.query(bql);

			if (result?.errors?.length) {
				error = (result.errors as any[]).map((e) => e.message).join('; ');
				return;
			}

			const cols = result?.columns ?? [];
			const rows = result?.rows ?? [];
			const dateIdx = cols.indexOf('date');
			const accountIdx = cols.indexOf('account');
			const numberIdx = cols.indexOf('number');
			const currencyIdx = cols.indexOf('currency');

			if (dateIdx === -1 || accountIdx === -1 || numberIdx === -1) {
				error = 'Unexpected query result columns.';
				return;
			}

			const incomeMap = new Map<string, Map<string, number>>();
			const expenseMap = new Map<string, Map<string, number>>();
			for (const { key } of monthList) {
				incomeMap.set(key, new Map());
				expenseMap.set(key, new Map());
			}

			for (const row of rows as any[]) {
				// Skip commodity positions — their units (e.g. 100 AAPL) get multiplied by
				// current market price by CONVERT, producing wildly inflated amounts.
				// Fiat and crypto currencies are ≤4 chars; stock tickers are typically longer.
				const origCurrency = currencyIdx !== -1 ? String(row[currencyIdx] ?? '') : currency ?? '';
				if (origCurrency.length > 4) continue;

				const dateStr = toDateStr(row[dateIdx]);
				const monthKey = dateStr.slice(0, 7);
				const account = String(row[accountIdx] ?? '');
				const amount = parseFloat(String(row[numberIdx] ?? '0')) || 0;

				if (account.startsWith('Income') && incomeMap.has(monthKey)) {
					const dm = incomeMap.get(monthKey)!;
					dm.set(dateStr, (dm.get(dateStr) ?? 0) + -amount); // negate: income is negative in beancount
				} else if (account.startsWith('Expenses') && expenseMap.has(monthKey)) {
					const dm = expenseMap.get(monthKey)!;
					dm.set(dateStr, (dm.get(dateStr) ?? 0) + amount);
				}
			}

			function buildDetails(
				list: { key: string; label: string }[],
				map: Map<string, Map<string, number>>
			): MonthDetail[] {
				return list.map(({ key, label }) => {
					const dayMap = map.get(key) ?? new Map();
					const days: DayEntry[] = [...dayMap.entries()]
						.sort(([a], [b]) => b.localeCompare(a))
						.map(([date, amount]) => {
							const d = new Date(date + 'T00:00:00');
							return {
								date,
								label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
								amount
							};
						});
					return { key, label, total: days.reduce((s, d) => s + d.amount, 0), days, isOutlier: false };
				});
			}

			const rawIncome = markOutliers(buildDetails(monthList, incomeMap));
			const rawExpenses = markOutliers(buildDetails(monthList, expenseMap));

			months = monthList.map((m) => m.label);
			incomeData = rawIncome.map((m) => m.total);
			expensesData = rawExpenses.map((m) => m.total);
			incomeMonths = [...rawIncome].reverse();
			expenseMonths = [...rawExpenses].reverse();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => loadData());
</script>

<article class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Income vs Expenses" />

	<div class="flex items-center gap-3 border-b border-base-300 px-4 py-2">
		<span class="text-sm font-medium text-base-content/60">Period:</span>
		<select
			class="select select-bordered select-sm"
			bind:value={selectedPeriod}
			onchange={() => loadData()}
			disabled={isLoading}
		>
			<option value="last12">Last 12 months</option>
			{#each availableYears as year}
				<option value={String(year)}>{year}</option>
			{/each}
		</select>
	</div>

	<section class="grow overflow-y-auto touch-pan-y px-4 py-4">
		{#if isLoading}
			<div class="flex justify-center py-12">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if error}
			<div class="rounded-lg border border-error bg-error/10 p-3 text-error text-sm font-mono">
				{error}
			</div>
		{:else}
			{#if months.length > 0}
				<IncomeExpenseChart {months} income={incomeData} expenses={expensesData} />
			{:else}
				<div class="py-12 text-center text-base-content/50 text-sm">No data available.</div>
			{/if}

			{#if incomeMonths.length > 0 || expenseMonths.length > 0}
				<div class="mt-6 flex flex-col gap-3">
					<!-- Income breakdown -->
					<AccordionSection
						title="Income"
						badge={incomeTotal > 0 ? incomeTotal.toFixed(2) : undefined}
						expanded={incomeExpanded}
						onToggle={() => (incomeExpanded = !incomeExpanded)}
					>
						<div class="flex flex-col divide-y divide-base-200">
							{#each incomeMonths as month}
								<details class="group">
									<summary
										class="flex cursor-pointer list-none items-center justify-between py-2 [&::-webkit-details-marker]:hidden"
									>
										<div class="flex items-center gap-2">
											{#if month.isOutlier}
												<span class="text-xs font-bold text-warning" title="Unusual amount">!</span>
											{/if}
											<span class="text-sm">{month.label}</span>
										</div>
										<div class="flex items-center gap-2">
											<div class="h-1.5 w-12 overflow-hidden rounded-full bg-base-300">
												<div
													class="h-full rounded-full bg-success"
													style="width: {((month.total / maxIncome) * 100).toFixed(0)}%"
												></div>
											</div>
											<span
												class="w-20 text-right font-mono text-sm tabular-nums"
												class:text-warning={month.isOutlier}>{month.total.toFixed(2)}</span
											>
											<span
												class="text-xs text-base-content/40 transition-transform group-open:rotate-90"
												>▶</span
											>
										</div>
									</summary>
									<div class="mb-2 ml-4 flex flex-col">
										<a
											href={txSearchUrl('^Income', month.key)}
											class="px-2 py-1 text-xs text-primary hover:underline"
											>All transactions — {month.label}</a
										>
										{#each month.days as day}
											<a
												href={txSearchUrl('^Income', undefined, day.date)}
												class="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-base-200"
											>
												<span class="text-base-content/70">{day.label}</span>
												<span class="font-mono tabular-nums">{day.amount.toFixed(2)}</span>
											</a>
										{/each}
									</div>
								</details>
							{/each}
						</div>
					</AccordionSection>

					<!-- Expenses breakdown -->
					<AccordionSection
						title="Expenses"
						badge={expensesTotal > 0 ? expensesTotal.toFixed(2) : undefined}
						expanded={expensesExpanded}
						onToggle={() => (expensesExpanded = !expensesExpanded)}
					>
						<div class="flex flex-col divide-y divide-base-200">
							{#each expenseMonths as month}
								<details class="group">
									<summary
										class="flex cursor-pointer list-none items-center justify-between py-2 [&::-webkit-details-marker]:hidden"
									>
										<div class="flex items-center gap-2">
											{#if month.isOutlier}
												<span class="text-xs font-bold text-warning" title="Unusual amount">!</span>
											{/if}
											<span class="text-sm">{month.label}</span>
										</div>
										<div class="flex items-center gap-2">
											<div class="h-1.5 w-12 overflow-hidden rounded-full bg-base-300">
												<div
													class="h-full rounded-full bg-error"
													style="width: {((month.total / maxExpenses) * 100).toFixed(0)}%"
												></div>
											</div>
											<span
												class="w-20 text-right font-mono text-sm tabular-nums"
												class:text-warning={month.isOutlier}>{month.total.toFixed(2)}</span
											>
											<span
												class="text-xs text-base-content/40 transition-transform group-open:rotate-90"
												>▶</span
											>
										</div>
									</summary>
									<div class="mb-2 ml-4 flex flex-col">
										<a
											href={txSearchUrl('^Expenses', month.key)}
											class="px-2 py-1 text-xs text-primary hover:underline"
											>All transactions — {month.label}</a
										>
										{#each month.days as day}
											<a
												href={txSearchUrl('^Expenses', undefined, day.date)}
												class="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-base-200"
											>
												<span class="text-base-content/70">{day.label}</span>
												<span class="font-mono tabular-nums">{day.amount.toFixed(2)}</span>
											</a>
										{/each}
									</div>
								</details>
							{/each}
						</div>
					</AccordionSection>
				</div>
			{/if}
		{/if}
	</section>
</article>
