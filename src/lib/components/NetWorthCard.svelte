<!--
  NetWorthCard — Home screen card showing net worth over a user-defined period
  as a mountain (area) line chart with end-of-month data points.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { TrendingUpIcon, Settings2Icon } from '@lucide/svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import NetWorthMountainChart from './NetWorthMountainChart.svelte';
	import { type Period } from './PeriodPicker.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '$lib/settings';
	import { formatAmount } from '$lib/utils/formatter';
	import { goto } from '$app/navigation';

	interface MonthEntry {
		label: string;
		netWorth: number;
	}

	const DEFAULT_PERIOD: Period = { n: 12, unit: 'months' };

	let period = $state<Period>({ ...DEFAULT_PERIOD });
	let monthEntries = $state<MonthEntry[]>([]);
	let baseCurrency = $state('');
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let settingsLoaded = $state(false);

	let months = $derived(monthEntries.map((e) => e.label));
	let netWorthData = $derived(monthEntries.map((e) => e.netWorth));
	let latestNetWorth = $derived(
		monthEntries.length > 0 ? monthEntries[monthEntries.length - 1].netWorth : null
	);
	let change = $derived(
		monthEntries.length >= 2
			? monthEntries[monthEntries.length - 1].netWorth - monthEntries[0].netWorth
			: null
	);

	onMount(async () => {
		// Load saved period first so loadData() uses the right window.
		const saved = await settings.get<Period>(SettingKeys.netWorthPeriod);
		if (saved?.n && saved?.unit) period = saved;

		const currency = await settings.get<string>(SettingKeys.currency);
		baseCurrency = currency ?? 'EUR';

		settingsLoaded = true;
		// $effect below wires the ledger subscription after settings are ready.
	});

	// Reactive: subscribe to ledger load events once settings are ready.
	// subscribe fires immediately with current value — handles the "already loaded" case.
	$effect(() => {
		if (!settingsLoaded) return;
		const unsubscribe = fullLedgerService.loaded.subscribe((loaded) => {
			if (loaded) void loadData();
		});
		return unsubscribe;
	});

	/** Convert any period to a count of month-end sample points. */
	function toMonths(p: Period): number {
		switch (p.unit) {
			case 'days':   return Math.max(1, Math.ceil(p.n / 30));
			case 'weeks':  return Math.max(1, Math.ceil(p.n / 4.33));
			case 'months': return p.n;
			case 'years':  return p.n * 12;
		}
	}

	/** Build the list of month-end date strings going back from today. */
	function buildMonthEnds(count: number): { label: string; endDate: string }[] {
		const now = new Date();
		const result: { label: string; endDate: string }[] = [];

		for (let i = count - 1; i >= 0; i--) {
			const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
			const key = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

			let endDateStr: string;
			if (i === 0) {
				// Current (partial) month: use today.
				endDateStr = now.toISOString().slice(0, 10);
			} else {
				const nextMonthStart = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
				const end = new Date(nextMonthStart.getTime() - 1);
				endDateStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
			}

			result.push({ label: key, endDate: endDateStr });
		}
		return result;
	}

	function parseValue(raw: unknown): number {
		if (raw == null) return 0;
		if (typeof raw === 'object' && (raw as any).number != null) {
			return parseFloat((raw as any).number) || 0;
		}
		const str = String(raw).trim();
		const match = str.match(/^([−-]?[\d,]*\.?\d+)\s+\S+$/);
		return match ? parseFloat(match[1].replace(/,/g, '').replace('−', '-')) || 0 : 0;
	}

	async function loadData() {
		if (!settingsLoaded) return;
		isLoading = true;
		error = null;

		try {
			const monthCount = toMonths(period);
			const monthEnds = buildMonthEnds(monthCount);
			const entries: MonthEntry[] = [];

			for (const { label, endDate } of monthEnds) {
				const bql = `SELECT value(sum(position), '${baseCurrency}') AS value WHERE account ~ "^(Assets|Liabilities)" AND date <= ${endDate}`;
				const result = await fullLedgerService.query(bql);

				if (result?.errors?.length) {
					error = (result.errors as any[]).map((e: any) => e.message).join('; ');
					return;
				}

				const cols = result?.columns ?? [];
				const rows = result?.rows ?? [];
				const valIdx = cols.indexOf('value');
				const nw = valIdx !== -1 && rows.length > 0 ? parseValue((rows[0] as any[])[valIdx]) : 0;
				entries.push({ label, netWorth: nw });
			}

			monthEntries = entries;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}


	function onCardClick() {
		void goto('/reports/net-worth');
	}
</script>

<HomeCardTemplate onclick={onCardClick}>
	{#snippet icon()}
		<TrendingUpIcon />
	{/snippet}
	{#snippet title()}
		Net Worth
	{/snippet}
	{#snippet menu()}
		<a href="/net-worth-card-settings" onclick={(e) => e.stopPropagation()} aria-label="Net Worth card settings">
			<Settings2Icon />
		</a>
	{/snippet}
	{#snippet content()}
		<div class="px-2 pb-2">
			{#if isLoading}
				<div class="flex justify-center py-6">
					<span class="loading loading-spinner loading-sm opacity-50"></span>
				</div>
			{:else if error}
				<p class="text-error text-xs font-mono py-2">{error}</p>
			{:else if monthEntries.length === 0}
				<p class="text-base-content/50 text-sm py-4 text-center">No data available.</p>
			{:else}
				{#if latestNetWorth !== null}
					<div class="mb-1 flex items-baseline justify-between px-1">
						<span class="text-xs text-base-content/50">Current</span>
						<span class="font-mono text-sm tabular-nums font-semibold">
							{formatAmount(latestNetWorth)}
							<span class="text-xs text-base-content/50 ml-1">{baseCurrency}</span>
						</span>
					</div>
				{/if}

				<NetWorthMountainChart {months} netWorth={netWorthData} currency={baseCurrency} />

				{#if change !== null}
					<div class="mt-1 flex justify-end">
						<span
							class="text-xs tabular-nums font-mono"
							class:text-success={change >= 0}
							class:text-error={change < 0}
						>
							{change >= 0 ? '+' : ''}{formatAmount(change)}
							<span class="text-base-content/40 ml-1">over period</span>
						</span>
					</div>
				{/if}
			{/if}
		</div>
	{/snippet}
</HomeCardTemplate>
