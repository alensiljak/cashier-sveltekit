<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { tick } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import YearPeriodSelector from '$lib/components/YearPeriodSelector.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import RunningBalanceChart from '$lib/components/RunningBalanceChart.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '$lib/settings';
	import { formatAmount } from '$lib/utils/formatter';

	interface MonthEntry {
		key: string;
		label: string;
		endDate: string;
		balance: number;
	}

	let selectedPeriod = $state('last12');
	let selectedAccount = $state('');
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let baseCurrency = $state('');
	let monthEntries = $state<MonthEntry[]>([]);
	let allAccounts = $state<string[]>([]);

	// Get account from URL params if provided
	if (page.url.searchParams.has('account')) {
		selectedAccount = page.url.searchParams.get('account') ?? '';
	}
	if (page.url.searchParams.has('period')) {
		selectedPeriod = page.url.searchParams.get('period') ?? 'last12';
	}

	let months = $derived(monthEntries.map((m) => m.label));
	let balanceData = $derived(monthEntries.map((m) => m.balance));
	let latestBalance = $derived(
		monthEntries.length > 0 ? monthEntries[monthEntries.length - 1].balance : 0
	);

	function getLast12MonthEnds() {
		const now = new Date();
		const result: { key: string; label: string; endDate: string }[] = [];
		for (let i = 11; i >= 0; i--) {
			const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
			const nextMonthStart = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
			const endDate = new Date(nextMonthStart.getTime() - 1);
			const key = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
			const label = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
			const endDateStr =
				i === 0
					? now.toISOString().slice(0, 10) // current, partial month: use today
					: `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
			result.push({ key, label, endDate: endDateStr });
		}
		return result;
	}

	function getYearMonthEnds(year: number) {
		const result: { key: string; label: string; endDate: string }[] = [];
		for (let m = 0; m < 12; m++) {
			const monthStart = new Date(year, m, 1);
			const nextMonthStart = new Date(year, m + 1, 1);
			const endDate = new Date(nextMonthStart.getTime() - 1);
			const key = `${year}-${String(m + 1).padStart(2, '0')}`;
			const label = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
			const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
			result.push({ key, label, endDate: endDateStr });
		}
		return result;
	}

	function getMonthList() {
		if (selectedPeriod === 'last12') return getLast12MonthEnds();
		const year = parseInt(selectedPeriod);
		if (isNaN(year)) return getLast12MonthEnds();
		return getYearMonthEnds(year);
	}

	function parseValue(raw: unknown): number {
		if (raw == null) return 0;
		if (typeof raw === 'object' && (raw as any).number != null) {
			return parseFloat((raw as any).number) || 0;
		}
		const str = String(raw).trim();
		const match = str.match(/^([\u2212-]?[\d,]*\.?\d+)\s+\S+$/);
		return match ? parseFloat(match[1].replace(/,/g, '').replace('\u2212', '-')) || 0 : 0;
	}

	async function loadAccounts() {
		try {
			await fullLedgerService.ensureLoaded();
			const result = await fullLedgerService.query(
				`SELECT account FROM #accounts WHERE account ~ "^(Assets|Liabilities|Equity|Income|Expenses)" AND close IS NULL ORDER BY account`
			);
			if (!result?.errors?.length) {
				const accountIdx = (result?.columns ?? []).indexOf('account');
				if (accountIdx !== -1) {
					allAccounts = (result?.rows ?? []).map((row) =>
						String((row as any[])[accountIdx] ?? '')
					);
				}
			}
			// If an account is selected but not in the list (maybe it's closed), still try to use it
			if (selectedAccount && !allAccounts.includes(selectedAccount)) {
				allAccounts = [selectedAccount, ...allAccounts];
			}
		} catch (e) {
			console.error('Error loading accounts:', e);
		}
	}

	async function loadData() {
		if (!selectedAccount) {
			monthEntries = [];
			return;
		}

		isLoading = true;
		error = null;
		await tick();

		try {
			const currency = await settings.get<string>(SettingKeys.currency);
			baseCurrency = currency ?? 'EUR';
			await fullLedgerService.ensureLoaded();

			const months = getMonthList();
			const entries: MonthEntry[] = [];

			for (const { key, label, endDate } of months) {
				// Query the balance for the specific account at the end of the month
				const bql = `SELECT value(sum(position), '${baseCurrency}') AS value WHERE account = '${selectedAccount}' AND date <= ${endDate}`;
				const result = await fullLedgerService.query(bql);

				if (result?.errors?.length) {
					error = (result.errors as any[]).map((e: any) => e.message).join('; ');
					return;
				}

				const cols = result?.columns ?? [];
				const rows = result?.rows ?? [];
				const valIdx = cols.indexOf('value');
				const balance = valIdx !== -1 && rows.length > 0 ? parseValue((rows[0] as any[])[valIdx]) : 0;

				entries.push({ key, label, endDate, balance });
			}

			monthEntries = entries;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	// Load accounts on mount and then load data if account is selected
	onMount(async () => {
		await loadAccounts();
		if (selectedAccount) {
			await loadData();
		}
	});
</script>

<main class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Running Balance" />

	<div class="border-b border-base-300 px-4 py-2">
		<SearchableSelect
			bind:value={selectedAccount}
			options={allAccounts}
			placeholder="Select an account..."
			onchange={loadData}
		/>
	</div>

	<YearPeriodSelector
		bind:selectedPeriod
		onChange={loadData}
		disabled={isLoading || !selectedAccount}
	/>

	<section class="grow overflow-y-auto touch-pan-y px-4 py-4">
		{#if !selectedAccount}
			<div class="flex flex-col items-center justify-center h-full text-base-content/50">
				<p class="text-center">Please select an account to view running balance.</p>
			</div>
		{:else if isLoading}
			<div class="flex justify-center py-12">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if error}
			<div class="rounded-lg border border-error bg-error/10 p-3 text-error text-sm font-mono">
				{error}
			</div>
		{:else if monthEntries.length > 0}
			<div class="mb-4 flex items-baseline justify-between">
				<span class="text-sm font-medium text-base-content/60">Current balance</span>
				<span class="font-mono text-lg tabular-nums">{formatAmount(latestBalance)} {baseCurrency}</span>
			</div>

			<RunningBalanceChart {months} balances={balanceData} currency={baseCurrency} />

			<div class="flex flex-col divide-y divide-base-200">
				{#each [...monthEntries].reverse() as month}
					<div class="flex items-center justify-between py-2">
						<span class="text-sm">{month.label}</span>
						<span class="font-mono text-sm tabular-nums">{formatAmount(month.balance)}</span>
					</div>
				{/each}
			</div>
		{:else}
			<div class="py-12 text-center text-base-content/50 text-sm">No data available for this account.</div>
		{/if}
	</section>
</main>
