<script lang="ts">
	import { onMount } from 'svelte';
	import { tick } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import NetWorthChart from '$lib/components/NetWorthChart.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '$lib/settings';
	import { formatAmount } from '$lib/utils/formatter';

	interface MonthEntry {
		key: string;
		label: string;
		netWorth: number;
	}

	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let baseCurrency = $state('');
	let monthEntries = $state<MonthEntry[]>([]);

	let months = $derived(monthEntries.map((m) => m.label));
	let netWorthData = $derived(monthEntries.map((m) => m.netWorth));
	let latestNetWorth = $derived(
		monthEntries.length > 0 ? monthEntries[monthEntries.length - 1].netWorth : 0
	);

	function getLast12MonthEnds() {
		const now = new Date();
		const result: { key: string; label: string; endDate: string }[] = [];
		for (let i = 11; i >= 0; i--) {
			// First of the target month, then the day before the *following* month = last day of target month.
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
		isLoading = true;
		error = null;
		await tick();

		try {
			const currency = await settings.get<string>(SettingKeys.currency);
			baseCurrency = currency ?? 'EUR';
			await fullLedgerService.ensureLoaded();

			const months = getLast12MonthEnds();
			const entries: MonthEntry[] = [];

			for (const { key, label, endDate } of months) {
				const bql = `SELECT value(sum(position), '${baseCurrency}') AS value WHERE account ~ "^(Assets|Liabilities)" AND date <= ${endDate}`;
				const result = await fullLedgerService.query(bql);

				if (result?.errors?.length) {
					error = (result.errors as any[]).map((e: any) => e.message).join('; ');
					return;
				}

				const cols = result?.columns ?? [];
				const rows = result?.rows ?? [];
				const valIdx = cols.indexOf('value');
				const netWorth = valIdx !== -1 && rows.length > 0 ? parseValue((rows[0] as any[])[valIdx]) : 0;

				entries.push({ key, label, netWorth });
			}

			monthEntries = entries;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => loadData());
</script>

<main class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Net Worth" />

	<section class="grow overflow-y-auto touch-pan-y px-4 py-4">
		{#if isLoading}
			<div class="flex justify-center py-12">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if error}
			<div class="rounded-lg border border-error bg-error/10 p-3 text-error text-sm font-mono">
				{error}
			</div>
		{:else if monthEntries.length > 0}
			<div class="mb-4 flex items-baseline justify-between">
				<span class="text-sm font-medium text-base-content/60">Current net worth</span>
				<span class="font-mono text-lg tabular-nums">{formatAmount(latestNetWorth)} {baseCurrency}</span>
			</div>

			<NetWorthChart {months} netWorth={netWorthData} />

			<div class="mt-4 flex flex-col divide-y divide-base-200">
				{#each [...monthEntries].reverse() as month}
					<div class="flex items-center justify-between py-2">
						<span class="text-sm">{month.label}</span>
						<span class="font-mono text-sm tabular-nums">{formatAmount(month.netWorth)}</span>
					</div>
				{/each}
			</div>
		{:else}
			<div class="py-12 text-center text-base-content/50 text-sm">No data available.</div>
		{/if}
	</section>
</main>
