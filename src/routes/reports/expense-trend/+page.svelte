<script lang="ts">
	import { tick } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { addMonths, endOfMonth, formatDate, parseDate, startOfMonth } from '#lib/utils/dates';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import StackedExpenseChart from '#lib/components/StackedExpenseChart.svelte';
	import TimeRangeSelector, {
		type TimeRange,
		type TimeRangeState
	} from '#lib/components/TimeRangeSelector.svelte';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '#lib/settings';
	import { ISODATEFORMAT } from '#lib/constants';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import { ReceiptIcon } from '@lucide/svelte';

	// The URL is the source of truth for which period is showing (see reports/expenses for
	// the same pattern): ?period=&anchor= (or ?dateFrom=&dateTo= for the Custom chip),
	// written via replaceState on every selection, so the Back button restores the exact
	// period rather than always the hardcoded default.
	const urlDateFrom = page.url.searchParams.get('dateFrom');
	const urlDateTo = page.url.searchParams.get('dateTo');
	const urlPeriod = page.url.searchParams.get('period');
	const urlAnchor = page.url.searchParams.get('anchor');
	const initialChip = urlDateFrom && urlDateTo ? 'custom' : (urlPeriod ?? 'rolling_12');
	const initialAnchor = urlAnchor ?? undefined;

	// How many top categories get their own series before the rest fold into "Other".
	const TOP_CATEGORY_COUNT = 6;

	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let months = $state<string[]>([]);
	let categories = $state<string[]>([]);
	let series = $state<number[][]>([]);
	let monthRanges = $state<{ key: string; dateFrom: string; dateTo: string }[]>([]);
	let currentRange = $state<TimeRange | null>(null);
	let currentRangeState = $state<TimeRangeState | null>(null);

	// Whole calendar months overlapping [dateFrom, dateTo], clipped to that range at the edges
	// (a custom or "This Month" range can start/end mid-month).
	function monthsBetween(dateFrom: string, dateTo: string) {
		const rangeStart = parseDate(dateFrom);
		const rangeEnd = parseDate(dateTo);
		const result: { key: string; label: string; dateFrom: string; dateTo: string }[] = [];
		let cur = startOfMonth(rangeStart);
		while (cur <= rangeEnd) {
			const monthEnd = endOfMonth(cur);
			const clippedFrom = cur > rangeStart ? cur : rangeStart;
			const clippedTo = monthEnd < rangeEnd ? monthEnd : rangeEnd;
			result.push({
				key: formatDate(cur, 'YYYY-MM'),
				label: formatDate(cur, 'MMM YY'),
				dateFrom: formatDate(clippedFrom, ISODATEFORMAT),
				dateTo: formatDate(clippedTo, ISODATEFORMAT)
			});
			cur = addMonths(cur, 1);
		}
		return result;
	}

	function toDateStr(raw: unknown): string {
		if (!raw) return '';
		const s = String(raw);
		if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
		const d = new Date(s);
		return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
	}

	// Main category = first two account segments, e.g. "Expenses:Food:Groceries" -> "Expenses:Food"
	function mainCategory(account: string): string {
		const parts = account.split(':');
		return parts.slice(0, 2).join(':');
	}

	function txSearchUrl(accountPattern: string, dateFrom: string, dateTo: string): string {
		const params = new URLSearchParams({ account: accountPattern, dateFrom, dateTo });
		return `/reports/tx-search?${params}`;
	}

	// Expense Categories report lists every account with a total for a period — link there
	// (rather than to a flat transaction list) whenever we can't point at one specific account.
	// Prefer period+anchor over raw dates: since both reports share the same chip/anchor
	// model, this opens Expense Categories on its normal "Month" (or whatever chip) with its
	// arrows/dropdown live, rather than stuck on a dead-end Custom range with no way to
	// scroll to a neighboring period without navigating back and re-drilling down. The anchor
	// is the month itself (an absolute date), so the link stays correct no matter when it's
	// opened — unlike a "steps back from today" offset, which would drift.
	function expenseCategoriesMonthUrl(monthKey: string): string {
		const params = new URLSearchParams({ period: 'month', anchor: `${monthKey}-01` });
		return `/reports/expenses?${params}`;
	}

	function expenseCategoriesUrlForState(state: TimeRangeState, range: TimeRange): string {
		const params =
			state.chip === 'custom'
				? new URLSearchParams({ dateFrom: range.dateFrom, dateTo: range.dateTo })
				: new URLSearchParams({ period: state.chip, anchor: state.anchor });
		return `/reports/expenses?${params}`;
	}

	function handleSegmentClick(category: string, monthIndex: number) {
		const range = monthRanges[monthIndex];
		if (!range) return;
		if (category === 'Other') {
			// "Other" isn't one account pattern — send them to the full category breakdown
			// for that month instead of dumping every expense transaction unfiltered.
			goto(expenseCategoriesMonthUrl(range.key));
			return;
		}
		goto(txSearchUrl(`^${category}`, range.dateFrom, range.dateTo));
	}

	async function loadData(range: TimeRange, state: TimeRangeState) {
		isLoading = true;
		error = null;
		currentRange = range;
		currentRangeState = state;

		const params =
			state.chip === 'custom'
				? new URLSearchParams({ dateFrom: range.dateFrom, dateTo: range.dateTo })
				: new URLSearchParams({ period: state.chip, anchor: state.anchor });
		replaceState(`?${params}`, {});

		await tick();

		try {
			const currency = await settings.get<string>(SettingKeys.currency);
			await fullLedgerService.ensureLoaded();

			const monthList = monthsBetween(range.dateFrom, range.dateTo);
			monthRanges = monthList.map(({ key, dateFrom, dateTo }) => ({ key, dateFrom, dateTo }));

			const bql = `SELECT date, account, NUMBER(CONVERT(units(position), '${currency}')) AS number, currency WHERE account ~ "^Expenses" AND date >= ${range.dateFrom} AND date <= ${range.dateTo}`;
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

			// totals[monthKey][category] = sum
			const totals = new Map<string, Map<string, number>>();
			const categoryTotals = new Map<string, number>();
			for (const { key } of monthList) totals.set(key, new Map());

			for (const row of rows as any[]) {
				// Skip commodity positions (stock tickers longer than fiat/crypto codes) —
				// CONVERT would multiply units by current market price, inflating amounts.
				const origCurrency = currencyIdx !== -1 ? String(row[currencyIdx] ?? '') : currency ?? '';
				if (origCurrency.length > 4) continue;

				const dateStr = toDateStr(row[dateIdx]);
				const monthKey = dateStr.slice(0, 7);
				if (!totals.has(monthKey)) continue;

				const account = String(row[accountIdx] ?? '');
				const category = mainCategory(account);
				const amount = parseFloat(String(row[numberIdx] ?? '0')) || 0;

				const monthMap = totals.get(monthKey)!;
				monthMap.set(category, (monthMap.get(category) ?? 0) + amount);
				categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + amount);
			}

			const topCategories = [...categoryTotals.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, TOP_CATEGORY_COUNT)
				.map(([cat]) => cat);
			const hasOther = categoryTotals.size > topCategories.length;

			months = monthList.map((m) => m.label);
			categories = hasOther ? [...topCategories, 'Other'] : topCategories;
			series = categories.map((category) =>
				monthList.map(({ key }) => {
					const monthMap = totals.get(key)!;
					if (category === 'Other') {
						let sum = 0;
						for (const [cat, val] of monthMap) {
							if (!topCategories.includes(cat)) sum += val;
						}
						return sum;
					}
					return monthMap.get(category) ?? 0;
				})
			);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}
</script>

<main class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Expense Trend">
		{#snippet actions()}
			<button
				class="btn btn-ghost btn-sm btn-square"
				disabled={!currentRange || !currentRangeState}
				onclick={() =>
					currentRange &&
					currentRangeState &&
					goto(expenseCategoriesUrlForState(currentRangeState, currentRange))}
				title="View all categories for this period"
			>
				<ReceiptIcon size={18} />
			</button>
			<HelpButton topic="report-expense-trend" />
		{/snippet}
	</Toolbar>

	<div class="border-b border-base-300 px-4 py-3">
		<TimeRangeSelector
			onselect={loadData}
			initial={initialChip}
			{initialAnchor}
			initialCustomFrom={urlDateFrom ?? undefined}
			initialCustomTo={urlDateTo ?? undefined}
		/>
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
		{:else if months.length === 0 || categories.length === 0}
			<div class="py-12 text-center text-base-content/50 text-sm">No expense data available.</div>
		{:else}
			<StackedExpenseChart {months} {categories} {series} onclick={handleSegmentClick} />
		{/if}
	</section>
</main>
