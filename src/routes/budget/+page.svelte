<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import MonthSelector, { type MonthOption } from '$lib/components/MonthSelector.svelte';
	import BudgetCategoryRow from '$lib/components/BudgetCategoryRow.svelte';
	import { selectionMetadata, BudgetSelectedMonthStore } from '$lib/data/mainStore';
	import { type BudgetCategory, SelectionModeMetadata, SettingKeys, settings } from '$lib/settings';
	import { SelectionType } from '$lib/enums';
	import appService from '$lib/services/appService';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import Notifier from '$lib/utils/notifier';
	import { formatAmount } from '$lib/utils/formatter';
	import { ArrowUpDownIcon, PlusCircleIcon, TrashIcon } from '@lucide/svelte';

	Notifier.init();

	// Disambiguates our use of the shared selection-mode store from other pages
	// that also send the user to /accounts.
	const BUDGET_ORIGIN = 'budget';

	// Budget categories are scoped to Expenses accounts for now. Kept as a
	// single constant so widening the scope later (e.g. Income) only touches
	// this line plus the BQL WHERE clause below.
	const CATEGORY_PREFIX = 'Expenses:';

	let categories = $state<BudgetCategory[]>([]);
	let actuals = $state<Map<string, number>>(new Map());
	let currentMonth = $state<MonthOption | null>(null);
	let currency = $state('');
	let dataLoaded = $state(false);
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	const totalBudgeted = $derived(categories.reduce((sum, c) => sum + (c.amount || 0), 0));
	const totalActual = $derived(categories.reduce((sum, c) => sum + (actuals.get(c.account) ?? 0), 0));

	onMount(async () => {
		await handleCategorySelection();

		currency = await appService.getDefaultCurrency();
		categories = (await settings.get<BudgetCategory[]>(SettingKeys.budgetDefinition)) ?? [];
		dataLoaded = true;
	});

	// Reload actuals whenever the selected month changes, or the category list
	// itself changes (add/remove); editing a budgeted amount does not need a
	// ledger round trip, so it isn't tracked here.
	$effect(() => {
		if (!dataLoaded || !currentMonth) return;
		void categories;
		loadActuals(currentMonth);
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

	function onMonthSelect(month: MonthOption) {
		currentMonth = month;
		$BudgetSelectedMonthStore = month.key;
	}

	/**
	 * Fetch actuals for every category in a single BQL round trip: pull all
	 * Expenses postings for the month, then bucket each posting into the most
	 * specific (longest account name) matching category. This makes a parent
	 * category (e.g. Expenses:Food) roll up postings to its sub-accounts (e.g.
	 * Expenses:Food:Restaurants) while avoiding double-counting when both a
	 * category and one of its own descendants are budgeted separately.
	 */
	async function loadActuals(month: MonthOption) {
		if (categories.length === 0) {
			actuals = new Map();
			return;
		}

		isLoading = true;
		error = null;

		try {
			await fullLedgerService.ensureLoaded();

			const bql = `SELECT account, NUMBER(CONVERT(units(position), "${currency}")) AS number WHERE account ~ "^${CATEGORY_PREFIX}" AND date >= ${month.dateFrom} AND date <= ${month.dateTo}`;
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

	async function onAmountChange(account: string, amount: number) {
		const index = categories.findIndex((c) => c.account === account);
		if (index === -1) return;

		categories[index].amount = amount;
		await settings.set(SettingKeys.budgetDefinition, categories);
	}

	/**
	 * Open the transaction search report scoped to this category (including its
	 * sub-accounts, same rollup as the actuals query) and the currently
	 * selected month.
	 */
	function onCategoryClick(account: string) {
		if (!currentMonth) return;

		const params = new URLSearchParams({
			account: `^${account}(:|$)`,
			dateFrom: currentMonth.dateFrom,
			dateTo: currentMonth.dateTo
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
		{#snippet menuItems()}
			<ToolbarMenuItem text="Add Category" Icon={PlusCircleIcon} onclick={onAddCategoryClicked} />
			<ToolbarMenuItem text="Delete Categories" Icon={TrashIcon} onclick={onDeleteCategoriesClicked} />
			<ToolbarMenuItem text="Reorder" Icon={ArrowUpDownIcon} onclick={onReorderClicked} />
		{/snippet}
	</Toolbar>

	<div class="flex items-center gap-3 px-4 pt-3 pb-2">
		<span class="text-sm font-medium text-base-content/60">Month:</span>
		<MonthSelector onselect={onMonthSelect} initialKey={$BudgetSelectedMonthStore} />
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
					amount={category.amount}
					actual={actuals.get(category.account) ?? 0}
					{currency}
					onAmountChange={(amount) => onAmountChange(category.account, amount)}
					onclick={onCategoryClick}
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
