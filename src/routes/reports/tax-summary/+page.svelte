<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '$lib/settings';
	import {
		buildTaxReport,
		currentFinancialYearStart,
		financialYearLabel,
		financialYearRange,
		validateTaxReportConfig
	} from '$lib/taxReport/engine';
	import {
		detectCurrencies,
		findUnconvertedCurrencies,
		type ConvertedAmount
	} from '$lib/taxReport/currencies';
	import { defaultTaxReportConfig } from '$lib/taxReport/templates';
	import type { CategoryResult, TaxReportConfig, TaxReportResult } from '$lib/taxReport/types';

	let config = $state<TaxReportConfig>(defaultTaxReportConfig);
	let startYear = $state(currentFinancialYearStart(defaultTaxReportConfig.yearStart));
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let result = $state<TaxReportResult | null>(null);
	let currency = $state('');
	let bookCurrencies = $state<string[]>([]);
	let mainCurrency = '';
	let unconverted = $state<string[]>([]);
	let configText = $state('');
	let configError = $state<string | null>(null);
	let showConfig = $state(false);

	let years = $derived(
		Array.from(
			{ length: 8 },
			(_, i) => currentFinancialYearStart(config.yearStart) - i
		)
	);
	let currencyOptions = $derived(
		[...new Set([...bookCurrencies, currency].filter(Boolean))].sort()
	);
	let range = $derived(financialYearRange(config.yearStart, startYear));

	function toDateStr(raw: unknown): string {
		const s = String(raw ?? '');
		return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
	}

	function txSearchUrl(account: string): string {
		const params = new URLSearchParams({
			account: `^${account}$`,
			dateFrom: range.from,
			dateTo: range.to
		});
		return `/reports/tx-search?${params}`;
	}

	/** Currencies in the book, excluding securities (commodities held at cost). */
	async function loadBookCurrencies() {
		const res = await fullLedgerService.query(
			'SELECT currency, cost_currency GROUP BY currency, cost_currency'
		);
		// On failure leave the list empty: the report then keeps every posting.
		if (res?.errors?.length) return;
		const cols = res?.columns ?? [];
		const ci = cols.indexOf('currency');
		const cci = cols.indexOf('cost_currency');
		const usages = ((res?.rows ?? []) as any[]).map((r) => ({
			currency: String(r[ci] ?? ''),
			costCurrency: cci === -1 ? null : ((r[cci] as string | null) ?? null)
		}));
		const operating = await fullLedgerService.getOperatingCurrencies();
		bookCurrencies = detectCurrencies(usages, operating);
	}

	async function changeCurrency() {
		await settings.set(SettingKeys.taxReportConfig, { ...config, currency });
		config = { ...config, currency };
		await loadData();
	}

	async function loadData() {
		isLoading = true;
		error = null;
		await tick();
		try {
			await fullLedgerService.ensureLoaded();
			if (!currency) currency = config.currency ?? mainCurrency;
			if (bookCurrencies.length === 0) await loadBookCurrencies();

			const bql = `SELECT date, account, NUMBER(CONVERT(units(position), '${currency}')) AS number, NUMBER(units(position)) AS units_number, currency WHERE (account ~ "^Income" OR account ~ "^Expenses") AND date >= ${range.from} AND date <= ${range.to}`;
			const res = await fullLedgerService.query(bql);
			if (res?.errors?.length) {
				error = (res.errors as any[]).map((e) => e.message).join('; ');
				return;
			}

			const cols = res?.columns ?? [];
			const dateIdx = cols.indexOf('date');
			const accountIdx = cols.indexOf('account');
			const numberIdx = cols.indexOf('number');
			const currencyIdx = cols.indexOf('currency');
			const unitsIdx = cols.indexOf('units_number');
			if (dateIdx === -1 || accountIdx === -1 || numberIdx === -1) {
				error = 'Unexpected query result columns.';
				return;
			}

			const postings = [];
			const amounts: ConvertedAmount[] = [];
			for (const row of (res?.rows ?? []) as any[]) {
				// Skip securities: CONVERT would value the units at market price.
				const orig = currencyIdx !== -1 ? String(row[currencyIdx] ?? '') : currency;
				if (bookCurrencies.length > 0 && !bookCurrencies.includes(orig)) continue;
				const amount = parseFloat(String(row[numberIdx] ?? '0')) || 0;
				postings.push({
					date: toDateStr(row[dateIdx]),
					account: String(row[accountIdx] ?? ''),
					amount
				});
				if (unitsIdx !== -1) {
					amounts.push({
						currency: orig,
						units: parseFloat(String(row[unitsIdx] ?? '0')) || 0,
						converted: amount
					});
				}
			}
			unconverted = findUnconvertedCurrencies(amounts, currency);
			result = buildTaxReport(config, postings);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	function applyConfigText() {
		let parsed: unknown;
		try {
			parsed = JSON.parse(configText);
		} catch {
			configError = 'Not valid JSON.';
			return;
		}
		const problem = validateTaxReportConfig(parsed);
		if (problem) {
			configError = problem;
			return;
		}
		configError = null;
		return saveConfig(parsed as TaxReportConfig);
	}

	async function saveConfig(next: TaxReportConfig) {
		config = next;
		currency = next.currency ?? mainCurrency;
		await settings.set(SettingKeys.taxReportConfig, next);
		startYear = currentFinancialYearStart(next.yearStart);
		showConfig = false;
		await loadData();
	}

	async function resetConfig() {
		configText = JSON.stringify(defaultTaxReportConfig, null, 2);
		await saveConfig(structuredClone(defaultTaxReportConfig));
	}

	function exportConfig() {
		const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = 'tax-report-config.json';
		a.click();
		URL.revokeObjectURL(a.href);
	}

	async function importConfig(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		configText = await file.text();
		await applyConfigText();
	}

	const fmt = (n: number) =>
		n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

	onMount(async () => {
		const saved = await settings.get<TaxReportConfig>(SettingKeys.taxReportConfig);
		if (saved && !validateTaxReportConfig(saved)) config = saved;
		mainCurrency = (await settings.get<string>(SettingKeys.currency)) ?? '';
		currency = config.currency ?? mainCurrency;
		configText = JSON.stringify(config, null, 2);
		startYear = currentFinancialYearStart(config.yearStart);
		await loadData();
	});
</script>

{#snippet section(title: string, items: CategoryResult[])}
	{#if items.length > 0}
		<h3 class="mt-4 mb-1 text-sm font-semibold text-base-content/60">{title}</h3>
		<div class="flex flex-col divide-y divide-base-200">
			{#each items as cat}
				<details class="group">
					<summary
						class="flex cursor-pointer list-none items-center justify-between py-2 [&::-webkit-details-marker]:hidden"
					>
						<span class="text-sm">{cat.name}</span>
						<span class="flex items-center gap-2">
							<span class="font-mono text-sm tabular-nums">{fmt(cat.total)}</span>
							<span class="text-xs text-base-content/40 transition-transform group-open:rotate-90"
								>▶</span
							>
						</span>
					</summary>
					<div class="mb-2 ml-4 flex flex-col">
						{#each cat.accounts as acc}
							<a
								href={txSearchUrl(acc.account)}
								class="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-base-200"
							>
								<span class="truncate text-base-content/70">{acc.account}</span>
								<span class="font-mono tabular-nums">{fmt(acc.total)}</span>
							</a>
						{:else}
							<span class="px-2 py-1 text-xs text-base-content/40">No postings.</span>
						{/each}
					</div>
				</details>
			{/each}
		</div>
	{/if}
{/snippet}

<main class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Tax Summary" />

	<div class="flex flex-wrap items-center gap-3 border-b border-base-300 px-4 py-2">
		<span class="text-sm font-medium text-base-content/60">Year:</span>
		<select
			class="select select-bordered select-sm"
			bind:value={startYear}
			onchange={() => loadData()}
			disabled={isLoading}
		>
			{#each years as y}
				<option value={y}>{financialYearLabel(config.yearStart, y)}</option>
			{/each}
		</select>
		<span class="text-sm font-medium text-base-content/60">Currency:</span>
		<select
			class="select select-bordered select-sm"
			bind:value={currency}
			onchange={changeCurrency}
			disabled={isLoading}
		>
			{#each currencyOptions as c}
				<option value={c}>{c}</option>
			{/each}
		</select>
		<span class="text-xs text-base-content/50">{range.from} → {range.to}</span>
	</div>

	<section class="mx-auto w-full max-w-2xl grow touch-pan-y overflow-y-auto px-4 py-4">
		<div class="text-xs text-base-content/50">
			{config.name}
		</div>

		{#if isLoading}
			<div class="flex justify-center py-12">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if error}
			<div class="rounded-lg border border-error bg-error/10 p-3 font-mono text-sm text-error">
				{error}
			</div>
		{:else if result}
			{#if unconverted.length > 0}
				<div class="mt-3 rounded-lg border border-warning bg-warning/10 p-3 text-sm">
					No exchange rate to {currency} found for {unconverted.join(', ')}. Those amounts are
					shown unconverted, so the totals mix currencies. Add price directives (e.g. {unconverted[0]}
					→ {currency}) to the book.
				</div>
			{/if}
			{@render section(
				'Income',
				result.categories.filter((c) => c.kind === 'income')
			)}
			{@render section(
				'Deductions',
				result.categories.filter((c) => c.kind === 'deduction')
			)}
			{#if result.unmapped.accounts.length > 0}
				{@render section('Not in any category (ledger sign)', [result.unmapped])}
			{/if}
		{/if}

		<div class="mt-8 border-t border-base-300 pt-4">
			<div class="flex flex-wrap gap-2">
				<button class="btn btn-sm" onclick={() => (showConfig = !showConfig)}>
					{showConfig ? 'Hide' : 'Edit'} config
				</button>
				<button class="btn btn-sm" onclick={exportConfig}>Export</button>
				<label class="btn btn-sm">
					Import
					<input type="file" accept="application/json" class="hidden" onchange={importConfig} />
				</label>
				<button class="btn btn-sm btn-ghost" onclick={resetConfig}>Reset to AU template</button>
			</div>
			{#if showConfig}
				<textarea
					class="textarea textarea-bordered mt-3 h-72 w-full font-mono text-xs"
					bind:value={configText}
				></textarea>
				{#if configError}
					<div class="mt-2 text-sm text-error">{configError}</div>
				{/if}
				<button class="btn btn-sm btn-primary mt-2" onclick={applyConfigText}>Save config</button>
			{/if}
		</div>
	</section>
</main>
