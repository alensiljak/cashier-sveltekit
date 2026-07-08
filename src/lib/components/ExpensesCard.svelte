<script lang="ts">
	import { ReceiptTextIcon, Settings2Icon, TrendingUpIcon, TrendingDownIcon, MinusIcon } from '@lucide/svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import moment from 'moment';
	import { ISODATEFORMAT, DEFAULT_EXPENSES_CARD_ROLLING_DAYS, NUMBER_FORMAT } from '$lib/constants';
	import { SettingKeys, settings } from '$lib/settings';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import numeral from 'numeral';

	const TOP_CATEGORY_COUNT = 5;

	interface CategoryTotal {
		account: string;
		label: string;
		amount: number;
	}

	interface DateRange {
		dateFrom: string;
		dateTo: string;
	}

	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let categories = $state<CategoryTotal[]>([]);
	let currentTotal = $state(0);
	let previousTotal = $state(0);
	// Base/default currency all amounts are converted into (SettingKeys.currency).
	let currency = $state('');
	// Measured width of the overlay stat box, so category rows can reserve
	// enough right padding to keep their amount readable underneath it.
	let statBoxWidth = $state(0);

	const maxCategoryAmount = $derived(categories.length ? categories[0].amount : 0);

	// 'up'/'down' reflect spending direction vs the prior period; 'flat' when
	// there is no prior data or the change is negligible (<1%).
	const trend = $derived.by<'up' | 'down' | 'flat'>(() => {
		if (previousTotal === 0) return currentTotal === 0 ? 'flat' : 'up';
		const changeRatio = Math.abs(currentTotal - previousTotal) / previousTotal;
		if (changeRatio < 0.01) return 'flat';
		return currentTotal > previousTotal ? 'up' : 'down';
	});

	onMount(() => {
		void loadData();
	});

	/** Resolve the current and comparison (prior, same-length) date ranges. */
	function resolvePeriods(periodType: string, rollingDays: number): { current: DateRange; previous: DateRange } {
		const today = moment();

		if (periodType === 'rolling-days') {
			const currentFrom = today.clone().subtract(rollingDays - 1, 'days');
			const previousTo = currentFrom.clone().subtract(1, 'day');
			const previousFrom = previousTo.clone().subtract(rollingDays - 1, 'days');
			return {
				current: { dateFrom: currentFrom.format(ISODATEFORMAT), dateTo: today.format(ISODATEFORMAT) },
				previous: { dateFrom: previousFrom.format(ISODATEFORMAT), dateTo: previousTo.format(ISODATEFORMAT) }
			};
		}

		// Calendar month: month-to-date vs the entirety of the prior month.
		const previousMonth = today.clone().subtract(1, 'month');
		return {
			current: { dateFrom: today.clone().startOf('month').format(ISODATEFORMAT), dateTo: today.format(ISODATEFORMAT) },
			previous: {
				dateFrom: previousMonth.clone().startOf('month').format(ISODATEFORMAT),
				dateTo: previousMonth.clone().endOf('month').format(ISODATEFORMAT)
			}
		};
	}

	/** Strip the "Expenses:" prefix and truncate for compact display. */
	function shortenAccount(account: string): string {
		const label = account.startsWith('Expenses:') ? account.slice('Expenses:'.length) : account;
		return label.length > 40 ? label.slice(0, 37) + '…' : label;
	}

	/** Query per-account expense totals for a date range, excluding hidden accounts. Sorted desc. */
	async function queryExpenseTotals(
		range: DateRange,
		currency: string,
		hiddenAccounts: Set<string>
	): Promise<[string, number][]> {
		const bql = `SELECT account, NUMBER(CONVERT(units(position), "${currency}")) AS number WHERE account ~ "^Expenses" AND date >= ${range.dateFrom} AND date <= ${range.dateTo}`;
		const result = await fullLedgerService.query(bql);

		if (result?.errors?.length) {
			throw new Error((result.errors as any[]).map((e) => e.message).join('; '));
		}

		const columns = result?.columns ?? [];
		const rows = result?.rows ?? [];
		const accountIdx = columns.indexOf('account');
		const numberIdx = columns.indexOf('number');
		if (accountIdx === -1 || numberIdx === -1) {
			throw new Error('Unexpected query result columns.');
		}

		const totals = new Map<string, number>();
		for (const row of rows as any[]) {
			const account = String(row[accountIdx] ?? '');
			if (hiddenAccounts.has(account)) continue;
			const amount = parseFloat(String(row[numberIdx] ?? '0')) || 0;
			totals.set(account, (totals.get(account) ?? 0) + amount);
		}

		return [...totals.entries()].sort((a, b) => b[1] - a[1]);
	}

	async function loadData() {
		isLoading = true;
		error = null;

		try {
			const periodType = (await settings.get<string>(SettingKeys.expensesCardPeriodType)) ?? 'calendar-month';
			const rollingDays =
				(await settings.get<number>(SettingKeys.expensesCardRollingDays)) ?? DEFAULT_EXPENSES_CARD_ROLLING_DAYS;
			// Reuse the same category exclusions configured for the Expenses report.
			const hiddenAccounts = new Set((await settings.get<string[]>(SettingKeys.expensesHiddenAccounts)) ?? []);
			currency = (await settings.get<string>(SettingKeys.currency)) ?? '';

			const { current, previous } = resolvePeriods(periodType, rollingDays);

			await fullLedgerService.ensureLoaded();

			const [currentSorted, previousSorted] = await Promise.all([
				queryExpenseTotals(current, currency, hiddenAccounts),
				queryExpenseTotals(previous, currency, hiddenAccounts)
			]);

			categories = currentSorted.slice(0, TOP_CATEGORY_COUNT).map(([account, amount]) => ({
				account,
				label: shortenAccount(account),
				amount
			}));
			currentTotal = currentSorted.reduce((sum, [, v]) => sum + v, 0);
			previousTotal = previousSorted.reduce((sum, [, v]) => sum + v, 0);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	function onCardClick() {
		void goto('/reports/expenses');
	}

	// Prevent the settings gear from also triggering the card's navigate-to-report click.
	function onSettingsClick(e: MouseEvent) {
		e.stopPropagation();
	}
</script>

<HomeCardTemplate onclick={onCardClick}>
	{#snippet icon()}
		<ReceiptTextIcon />
	{/snippet}
	{#snippet title()}
		Expenses
	{/snippet}
	{#snippet menu()}
		<a href="/expenses-card-settings" onclick={onSettingsClick} aria-label="Expenses card settings">
			<Settings2Icon />
		</a>
	{/snippet}
	{#snippet content()}
		{#if isLoading}
			<p>Loading expenses...</p>
		{:else if error}
			<p class="text-error text-sm">{error}</p>
		{:else if categories.length === 0}
			<p class="opacity-60">No expenses recorded for this period.</p>
		{:else}
			<div class="relative flex flex-col gap-1">
				{#each categories as category (category.account)}
					<div class="relative overflow-hidden rounded">
						<div
							class="bg-error/15 absolute inset-y-0 left-0"
							style="width: {maxCategoryAmount > 0 ? (category.amount / maxCategoryAmount) * 100 : 0}%"
						></div>
						<div
							class="relative flex items-center justify-between gap-2 py-1 pl-2 text-sm"
							style="padding-right: {statBoxWidth + 14}px"
						>
							<span class="truncate">{category.label}</span>
							<span class="text-error shrink-0 font-semibold">{numeral(category.amount).format(NUMBER_FORMAT)}</span>
						</div>
					</div>
				{/each}

				<div
					bind:clientWidth={statBoxWidth}
					class="bg-base-300/90 absolute top-1/2 right-1 flex -translate-y-1/2 flex-col items-center gap-1 rounded-lg px-3 py-2 shadow-sm backdrop-blur-sm"
				>
					<div class="flex items-center gap-1">
						{#if trend === 'up'}
							<TrendingUpIcon size={16} class="text-error shrink-0" />
						{:else if trend === 'down'}
							<TrendingDownIcon size={16} class="text-success shrink-0" />
						{:else}
							<MinusIcon size={16} class="shrink-0 opacity-50" />
						{/if}
						<span class="text-lg leading-none font-semibold whitespace-nowrap">{numeral(currentTotal).format(NUMBER_FORMAT)}</span>
					</div>
					<span class="text-xs whitespace-nowrap opacity-50">vs {numeral(previousTotal).format(NUMBER_FORMAT)}</span>
				</div>
			</div>
		{/if}
	{/snippet}
</HomeCardTemplate>
