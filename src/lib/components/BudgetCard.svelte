<script lang="ts">
	import { WalletIcon, Settings2Icon } from '@lucide/svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import moment from 'moment';
	import { ISODATEFORMAT, NUMBER_FORMAT } from '$lib/constants';
	import { type BudgetCategory, SettingKeys, settings } from '$lib/settings';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import numeral from 'numeral';

	const TOP_CATEGORY_COUNT = 5;
	// Categories at or above this fraction of their budget are shown first
	// (worst overspend first); remaining slots up to TOP_CATEGORY_COUNT are
	// filled with the rest, also ordered by (amount - budget) desc.
	const CLOSE_TO_BUDGET_RATIO = 0.8;
	const CATEGORY_PREFIX = 'Expenses:';

	interface BudgetRow {
		account: string;
		label: string;
		budget: number;
		actual: number;
		diff: number;
	}

	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let rows = $state<BudgetRow[]>([]);

	/** Fraction of budget spent so far (uncapped); budget<=0 with spend counts as fully over. */
	function budgetRatio(row: BudgetRow): number {
		return row.budget > 0 ? row.actual / row.budget : row.actual > 0 ? 1 : 0;
	}

	/** Bar width as % of budget, capped at 100 so overspend doesn't blow out the row. */
	function barWidthPct(row: BudgetRow): number {
		return Math.min(budgetRatio(row), 1) * 100;
	}

	onMount(() => {
		void loadData();
	});

	/** Strip the "Expenses:" prefix and truncate for compact display. */
	function shortenAccount(account: string): string {
		const label = account.startsWith(CATEGORY_PREFIX)
			? account.slice(CATEGORY_PREFIX.length)
			: account;
		return label.length > 40 ? label.slice(0, 37) + '…' : label;
	}

	async function loadData() {
		isLoading = true;
		error = null;

		try {
			const categories = (await settings.get<BudgetCategory[]>(SettingKeys.budgetDefinition)) ?? [];
			if (categories.length === 0) {
				rows = [];
				return;
			}

			const currency = (await settings.get<string>(SettingKeys.currency)) ?? '';
			const monthStart = moment().startOf('month');
			const dateFrom = monthStart.format(ISODATEFORMAT);
			const dateTo = moment().format(ISODATEFORMAT);

			await fullLedgerService.ensureLoaded();

			const bql = `SELECT account, NUMBER(CONVERT(units(position), "${currency}")) AS number WHERE account ~ "^${CATEGORY_PREFIX}" AND date >= ${dateFrom} AND date <= ${dateTo}`;
			const result = await fullLedgerService.query(bql);

			if (result?.errors?.length) {
				error = (result.errors as any[]).map((e) => e.message).join('; ');
				return;
			}

			const columns = result?.columns ?? [];
			const resultRows = result?.rows ?? [];
			const accountIdx = columns.indexOf('account');
			const numberIdx = columns.indexOf('number');
			if (accountIdx === -1 || numberIdx === -1) {
				error = 'Unexpected query result columns.';
				return;
			}

			// Bucket postings into the most specific (longest account name)
			// matching category, same rollup used on the Budget page.
			const totals = new Map<string, number>(categories.map((c) => [c.account, 0]));
			for (const row of resultRows as any[]) {
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

			const allRows: BudgetRow[] = categories.map((cat) => {
				const actual = totals.get(cat.account) ?? 0;
				return {
					account: cat.account,
					label: shortenAccount(cat.account),
					budget: cat.amount,
					actual,
					diff: actual - cat.amount
				};
			});

			const isCloseOrOver = (r: BudgetRow) =>
				r.budget > 0 && r.actual >= r.budget * CLOSE_TO_BUDGET_RATIO;
			const overOrClose = allRows.filter(isCloseOrOver).sort((a, b) => b.diff - a.diff);
			const rest = allRows.filter((r) => !isCloseOrOver(r)).sort((a, b) => b.diff - a.diff);

			rows = [...overOrClose, ...rest].slice(0, TOP_CATEGORY_COUNT);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	function onCardClick() {
		void goto('/budget');
	}

	// Prevent the settings gear from also triggering the card's navigate-to-report click.
	function onSettingsClick(e: MouseEvent) {
		e.stopPropagation();
	}
</script>

<HomeCardTemplate onclick={onCardClick}>
	{#snippet icon()}
		<WalletIcon />
	{/snippet}
	{#snippet title()}
		Budget
	{/snippet}
	{#snippet menu()}
		<a href="/budget" onclick={onSettingsClick} aria-label="Budget settings">
			<Settings2Icon />
		</a>
	{/snippet}
	{#snippet content()}
		{#if isLoading}
			<p>Loading budget...</p>
		{:else if error}
			<p class="text-error text-sm">{error}</p>
		{:else if rows.length === 0}
			<p class="opacity-60">No budget categories yet.</p>
		{:else}
			<div class="flex flex-col gap-1">
				{#each rows as row (row.account)}
					<div class="relative overflow-hidden rounded">
						<div
							class="absolute inset-y-0 left-0 opacity-20"
							class:bg-error={budgetRatio(row) >= 1}
							class:bg-warning={budgetRatio(row) >= CLOSE_TO_BUDGET_RATIO && budgetRatio(row) < 1}
							class:bg-success={budgetRatio(row) < CLOSE_TO_BUDGET_RATIO}
							style="width: {barWidthPct(row)}%"
						></div>
						<div class="relative flex items-center gap-2 py-1 pl-2 pr-2 text-sm">
							<span class="grow truncate">{row.label}</span>
							<span class="w-28 shrink-0 text-right text-xs tabular-nums opacity-60">
								{numeral(row.actual).format(NUMBER_FORMAT)} / {numeral(row.budget).format(
									NUMBER_FORMAT
								)}
							</span>
							<span
								class="w-16 shrink-0 text-right font-semibold tabular-nums"
								class:text-error={row.diff >= 0}
								class:text-warning={row.diff < 0 && budgetRatio(row) >= CLOSE_TO_BUDGET_RATIO}
							>
								{row.diff >= 0 ? '+' : ''}{numeral(row.diff).format(NUMBER_FORMAT)}
							</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/snippet}
</HomeCardTemplate>
