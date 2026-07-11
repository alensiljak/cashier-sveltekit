<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import moment from 'moment';
	import { ISODATEFORMAT } from '$lib/constants';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import MonthSelector, { type MonthOption } from '$lib/components/MonthSelector.svelte';
	import YearSelector, { type YearOption } from '$lib/components/YearSelector.svelte';
	import BudgetCategoryRow from '$lib/components/BudgetCategoryRow.svelte';
	import {
		selectionMetadata,
		BudgetSelectedMonthStore,
		BudgetSelectedYearStore,
		BudgetViewModeStore,
		type BudgetViewMode
	} from '$lib/data/mainStore';
	import { type BudgetCategory, SelectionModeMetadata, SettingKeys, settings } from '$lib/settings';
	import { SelectionType } from '$lib/enums';
	import appService from '$lib/services/appService';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import Notifier from '$lib/utils/notifier';
	import { formatAmount } from '$lib/utils/formatter';
	import { ArrowUpDownIcon, PlusCircleIcon, TrashIcon } from '@lucide/svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';

	Notifier.init();

	// Disambiguates our use of the shared selection-mode store from other pages
	// that also send the user to /accounts.
	const BUDGET_ORIGIN = 'budget';

	// Budget categories are scoped to Expenses accounts for now. Kept as a
	// single constant so widening the scope later (e.g. Income) only touches
	// this line plus the BQL WHERE clause below.
	const CATEGORY_PREFIX = 'Expenses:';

	// Months in a year — the multiplier applied to the flat monthly target
	// when showing the Year view.
	const MONTHS_PER_YEAR = 12;

	// MonthOption and YearOption share this shape; the actuals query only
	// ever needs a date range, so it works unchanged for either view.
	type DateRange = { dateFrom: string; dateTo: string };

	let categories = $state<BudgetCategory[]>([]);
	let actuals = $state<Map<string, number>>(new Map());
	let rollovers = $state<Map<string, number>>(new Map());
	let viewMode = $state<BudgetViewMode>('month');
	let currentMonth = $state<MonthOption | null>(null);
	let currentYear = $state<YearOption | null>(null);
	let currency = $state('');
	let dataLoaded = $state(false);
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	// The date range actuals are currently loaded for, whichever view is active.
	const activeRange = $derived<DateRange | null>(viewMode === 'month' ? currentMonth : currentYear);
	// Multiplier applied to each category's flat monthly amount for display —
	// annual totals don't need per-month bucketing (see loadActuals doc
	// comment), just this multiplier on the budgeted side.
	const budgetMultiplier = $derived(viewMode === 'month' ? 1 : MONTHS_PER_YEAR);

	const totalBudgeted = $derived(
		categories.reduce((sum, c) => sum + (c.amount || 0) * budgetMultiplier + (rollovers.get(c.account) ?? 0), 0)
	);
	const totalActual = $derived(categories.reduce((sum, c) => sum + (actuals.get(c.account) ?? 0), 0));

	onMount(async () => {
		await handleCategorySelection();

		currency = await appService.getDefaultCurrency();
		categories = (await settings.get<BudgetCategory[]>(SettingKeys.budgetDefinition)) ?? [];
		viewMode = $BudgetViewModeStore;
		dataLoaded = true;
	});

	// Reload actuals whenever the active date range changes (month/year
	// selection or the Month/Year toggle), or the category list itself
	// changes (add/remove); editing a budgeted amount does not need a ledger
	// round trip, so it isn't tracked here.
	$effect(() => {
		if (!dataLoaded || !activeRange) return;
		void categories;
		loadActuals(activeRange);
	});

	// Recompute rollover carry-forward whenever the selected month or the
	// category list (including rollover flags) changes. Only meaningful in
	// Month view — the Year view already totals the whole year, so there is
	// nothing to carry forward.
	$effect(() => {
		if (!dataLoaded) return;
		if (viewMode !== 'month' || !currentMonth) {
			rollovers = new Map();
			return;
		}
		void categories;
		loadRollovers(currentMonth);
	});

	async function handleCategorySelection() {
		if (!$selectionMetadata || $selectionMetadata.origin !== BUDGET_ORIGIN) return;
		if ($selectionMetadata.selectionType !== SelectionType.ACCOUNT) return;

		const accountName = $selectionMetadata.selectedId as string | undefined;
		selectionMetadata.set(undefined);

		if (!accountName) {
			Notifier.info('Selection canceled');
			return;
		}

		const existing = (await settings.get<BudgetCategory[]>(SettingKeys.budgetDefinition)) ?? [];
		if (existing.some((c) => c.account === accountName)) {
			Notifier.info('The category is already present');
			return;
		}

		const updated = [...existing, { account: accountName, amount: 0 }];
		await settings.set(SettingKeys.budgetDefinition, updated);
		categories = updated;
		Notifier.success('Category added');
	}

	function onViewModeSelect(mode: BudgetViewMode) {
		viewMode = mode;
		$BudgetViewModeStore = mode;
	}

	function onMonthSelect(month: MonthOption) {
		currentMonth = month;
		$BudgetSelectedMonthStore = month.key;
	}

	function onYearSelect(year: YearOption) {
		currentYear = year;
		$BudgetSelectedYearStore = year.key;
	}

	/**
	 * Fetch actuals for every category in a single BQL round trip over the
	 * given date range (a calendar month or a whole calendar year — both
	 * MonthOption and YearOption expose the same {dateFrom, dateTo} shape, so
	 * the query and bucketing logic are identical either way; annual totals
	 * are just a wider range, no per-month grouping needed). Postings are
	 * bucketed into the most specific (longest account name) matching
	 * category. This makes a parent category (e.g. Expenses:Food) roll up
	 * postings to its sub-accounts (e.g. Expenses:Food:Restaurants) while
	 * avoiding double-counting when both a category and one of its own
	 * descendants are budgeted separately.
	 */
	async function loadActuals(range: DateRange) {
		if (categories.length === 0) {
			actuals = new Map();
			return;
		}

		isLoading = true;
		error = null;

		try {
			await fullLedgerService.ensureLoaded();

			const bql = `SELECT account, NUMBER(CONVERT(units(position), "${currency}")) AS number WHERE account ~ "^${CATEGORY_PREFIX}" AND date >= ${range.dateFrom} AND date <= ${range.dateTo}`;
			const result = await fullLedgerService.query(bql);

			if (result?.errors?.length) {
				error = (result.errors as any[]).map((e) => e.message).join('; ');
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

			const totals = new Map<string, number>(categories.map((c) => [c.account, 0]));

			for (const row of rows as any[]) {
				const acct = String(row[accountIdx] ?? '');
				const amt = parseFloat(String(row[numberIdx] ?? '0')) || 0;

				let best: BudgetCategory | null = null;
				for (const cat of categories) {
					if (acct === cat.account || acct.startsWith(cat.account + ':')) {
						if (!best || cat.account.length > best.account.length) best = cat;
					}
				}
				if (best) totals.set(best.account, (totals.get(best.account) ?? 0) + amt);
			}

			actuals = totals;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Rollover: unspent budget from earlier months in the same calendar year
	 * carries forward into later ones (opt-in per category, floored at zero
	 * per month so overspending never creates a debt that reduces a future
	 * month's budget). Fetches one BQL round trip bucketed by
	 * (account, year, month) covering January through the month before the
	 * selected one, then for each rollover-enabled category sums
	 * max(0, budgeted - actual) per month from whichever is later of the
	 * category's `since` or the start of the year.
	 */
	async function loadRollovers(month: MonthOption) {
		const enabled = categories.filter((c) => c.rollover && c.since);
		const monthStart = moment(month.key, 'YYYY-MM');
		const yearStart = monthStart.clone().startOf('year');

		if (enabled.length === 0 || !monthStart.isAfter(yearStart, 'month')) {
			rollovers = new Map();
			return;
		}

		try {
			await fullLedgerService.ensureLoaded();

			const dateFrom = yearStart.format(ISODATEFORMAT);
			const dateTo = monthStart.format(ISODATEFORMAT); // exclusive: first day of the selected month
			const bql = `SELECT account, year(date) AS y, month(date) AS mo, number(value(sum(position), "${currency}")) AS number WHERE account ~ "^${CATEGORY_PREFIX}" AND date >= ${dateFrom} AND date < ${dateTo} GROUP BY account, year(date), month(date)`;
			const result = await fullLedgerService.query(bql);

			// Rollover is a soft enhancement layered on top of the actuals
			// already shown; a query failure here shouldn't block the page.
			if (result?.errors?.length) return;

			const columns = result?.columns ?? [];
			const rows = result?.rows ?? [];
			const accountIdx = columns.indexOf('account');
			const yearIdx = columns.indexOf('y');
			const monthIdx = columns.indexOf('mo');
			const numberIdx = columns.indexOf('number');
			if (accountIdx === -1 || yearIdx === -1 || monthIdx === -1 || numberIdx === -1) return;

			// Bucket into (category account) -> (month key 'YYYY-MM') -> actual,
			// using the same longest-prefix-match rollup as loadActuals.
			const monthly = new Map<string, Map<string, number>>();
			for (const row of rows as any[]) {
				const acct = String(row[accountIdx] ?? '');
				const y = parseInt(String(row[yearIdx] ?? ''), 10);
				const mo = parseInt(String(row[monthIdx] ?? ''), 10);
				const amt = parseFloat(String(row[numberIdx] ?? '0')) || 0;
				if (!y || !mo) continue;

				let best: BudgetCategory | null = null;
				for (const cat of categories) {
					if (acct === cat.account || acct.startsWith(cat.account + ':')) {
						if (!best || cat.account.length > best.account.length) best = cat;
					}
				}
				if (!best) continue;

				const key = `${y}-${String(mo).padStart(2, '0')}`;
				if (!monthly.has(best.account)) monthly.set(best.account, new Map());
				const map = monthly.get(best.account)!;
				map.set(key, (map.get(key) ?? 0) + amt);
			}

			const carried = new Map<string, number>();
			for (const cat of enabled) {
				const start = moment.max(moment(cat.since, 'YYYY-MM'), yearStart);
				for (const cursor = start.clone(); cursor.isBefore(monthStart, 'month'); cursor.add(1, 'month')) {
					const actualForMonth = monthly.get(cat.account)?.get(cursor.format('YYYY-MM')) ?? 0;
					carried.set(cat.account, (carried.get(cat.account) ?? 0) + Math.max(0, cat.amount - actualForMonth));
				}
			}

			rollovers = carried;
		} catch {
			// rollover is a soft enhancement; ignore failures rather than blocking the page
		}
	}

	async function onAmountChange(account: string, amount: number) {
		const index = categories.findIndex((c) => c.account === account);
		if (index === -1) return;

		// The row displays amount * budgetMultiplier (flat in Month view,
		// annualized in Year view); store back the underlying monthly figure
		// so the two views stay consistent with each other.
		categories[index].amount = amount / budgetMultiplier;
		await settings.set(SettingKeys.budgetDefinition, categories);
	}

	/**
	 * Toggle rollover for a category. Turning it on for the first time stamps
	 * `since` to the currently selected month so accumulation only starts
	 * from here forward, never retroactively from ledger history the
	 * category was never tracked against. Turning it off keeps `since` in
	 * place so re-enabling later resumes from where it left off, not from
	 * scratch.
	 */
	async function onRolloverToggle(account: string, enabled: boolean) {
		const index = categories.findIndex((c) => c.account === account);
		if (index === -1) return;

		categories[index].rollover = enabled;
		if (enabled && !categories[index].since && currentMonth) {
			categories[index].since = currentMonth.key;
		}
		await settings.set(SettingKeys.budgetDefinition, categories);
	}

	/**
	 * Open the transaction search report scoped to this category (including its
	 * sub-accounts, same rollup as the actuals query) and the currently
	 * selected date range (month or year, whichever view is active).
	 */
	function onCategoryClick(account: string) {
		if (!activeRange) return;

		const params = new URLSearchParams({
			account: `^${account}(:|$)`,
			dateFrom: activeRange.dateFrom,
			dateTo: activeRange.dateTo
		});
		goto(`/reports/tx-search?${params}`);
	}

	async function onAddCategoryClicked() {
		const meta = new SelectionModeMetadata();
		meta.origin = BUDGET_ORIGIN;
		meta.selectionType = SelectionType.ACCOUNT;
		meta.accountFilterPrefix = CATEGORY_PREFIX;
		selectionMetadata.set(meta);

		await goto('/accounts');
	}

	async function onDeleteCategoriesClicked() {
		await goto('/budget/delete');
	}

	async function onReorderClicked() {
		await goto('/budget/reorder');
	}
</script>

<main class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Budget">
		{#snippet actions()}
			<HelpButton topic="budget" />
		{/snippet}
		{#snippet menuItems()}
			<ToolbarMenuItem text="Add Category" Icon={PlusCircleIcon} onclick={onAddCategoryClicked} />
			<ToolbarMenuItem text="Delete Categories" Icon={TrashIcon} onclick={onDeleteCategoriesClicked} />
			<ToolbarMenuItem text="Reorder" Icon={ArrowUpDownIcon} onclick={onReorderClicked} />
		{/snippet}
	</Toolbar>

	<div class="flex flex-wrap items-center gap-3 px-4 pt-3 pb-2">
		<div class="join">
			<button
				type="button"
				class="join-item btn btn-sm {viewMode === 'month' ? 'btn-active' : 'btn-ghost border border-base-content/20'}"
				onclick={() => onViewModeSelect('month')}
			>
				Month
			</button>
			<button
				type="button"
				class="join-item btn btn-sm {viewMode === 'year' ? 'btn-active' : 'btn-ghost border border-base-content/20'}"
				onclick={() => onViewModeSelect('year')}
			>
				Year
			</button>
		</div>
		{#if viewMode === 'month'}
			<MonthSelector onselect={onMonthSelect} initialKey={$BudgetSelectedMonthStore} />
		{:else}
			<YearSelector onselect={onYearSelect} initialKey={$BudgetSelectedYearStore} />
		{/if}
	</div>

	<section class="grow overflow-y-auto touch-pan-y px-2 py-1">
		{#if !dataLoaded}
			<div class="flex justify-center py-12">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if error}
			<div class="rounded-lg border border-error bg-error/10 p-3 text-error text-sm font-mono">
				{error}
			</div>
		{:else if categories.length === 0}
			<div class="py-12 text-center text-base-content/50 text-sm">
				No budget categories yet. Use the menu to add one.
			</div>
		{:else}
			{#each categories as category (category.account)}
			<BudgetCategoryRow
					account={category.account}
					amount={category.amount * budgetMultiplier}
					actual={actuals.get(category.account) ?? 0}
					{currency}
					onAmountChange={(amount) => onAmountChange(category.account, amount)}
					onclick={onCategoryClick}
					rolloverAmount={viewMode === 'month' ? (rollovers.get(category.account) ?? 0) : 0}
					rolloverEnabled={!!category.rollover}
					onRolloverToggle={viewMode === 'month' ? (enabled) => onRolloverToggle(category.account, enabled) : undefined}
				/>
			{/each}
		{/if}
	</section>

	{#if categories.length > 0}
		<div class="flex items-center justify-end gap-2 border-t border-base-300 px-4 py-2 text-sm font-medium">
			<span class="text-base-content/60">Total:</span>
			<span class={totalActual > totalBudgeted ? 'text-error' : ''}>{formatAmount(totalActual)}</span>
			<span class="text-base-content/40">/</span>
			<span>{formatAmount(totalBudgeted)}</span>
			<span class="text-base-content/50">{currency}</span>
		</div>
	{/if}
</main>
