<script lang="ts">
	import { page } from '$app/state';
	import type { StockSymbol } from '$lib/assetAllocation/AssetClass.js';
	import type { CommodityDirective } from '$lib/assetAllocation/commodityYield.js';
	import {
		SecurityAnalyser,
		type SecurityAnalysis,
		type QueryFn
	} from '$lib/assetAllocation/securityAnalysis.js';
	import type { RawQueryResult, WasmQueryFn } from './+page.js';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { AaStocksStore, SecurityIrrCacheStore } from '$lib/data/mainStore';
	import * as Formatter from '$lib/utils/formatter.js';
	import { processWithConcurrencyLimit } from '$lib/utils/concurrency.js';
	import { getQueries } from '$lib/sync/sync-queries.js';
	import { PtaSystems } from '$lib/enums.js';
	import { Loader, X, Bug, ChevronDown, ChevronRight, RefreshCwIcon } from '@lucide/svelte';
	import YearPeriodSelector from '$lib/components/YearPeriodSelector.svelte';
	import {
		extractAllGroupFlows,
		type QueryFn as CashFlowQueryFn
	} from '$lib/portfolioReturns/cashFlows';
	import type { InvestmentGroup } from '$lib/portfolioReturns/investmentGroups';
	import { xirr, XirrNoSolutionError, holdingPeriodDays } from '$lib/utils/xirr';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import moment from 'moment';

	const name = page.params.name;
	let data = $state(page.data);
	let cursor = $state('');

	// Lots per symbol (main view)
	interface LotsData {
		columns: string[];
		rows: any[];
		loading: boolean;
		error?: string;
	}
	let lotsOpen: Record<string, boolean> = $state({});
	let lotsData: Record<string, LotsData> = $state({});

	// Debug panel
	let debugOpen = $state(false);
	let accountsOpen = $state(false);
	let assetClassValuesOpen = $state(false);
	let rawAccountsResult: (RawQueryResult & { loaded: boolean }) | null = $state(null);
	let symbolDebugOpen: Record<string, boolean> = $state({});

	interface SymbolDebugData {
		income: RawQueryResult | null;
		value: RawQueryResult | null;
		gainLoss: RawQueryResult | null;
		costOnly: RawQueryResult | null;
		rawPositions: RawQueryResult | null;
		loading: boolean;
		error?: string;
	}
	let symbolDebug: Record<string, SymbolDebugData> = $state({});

	// Per-security IRR (main view)
	interface IrrData {
		irrPct: number | null;
		irrError: string | null;
		irrHoldingDays: number | null;
		loading: boolean;
	}
	let irrBySymbol: Record<string, IrrData> = $state({});
	/** Same threshold/rationale as reports/portfolio-returns: a short holding span makes XIRR's
	 *  annualized rate real but easily-misread. */
	const SHORT_HOLDING_DAYS_THRESHOLD = 45;
	let selectedPeriod = $state('last12');

	/** Mirrors YearPeriodSelector's 'last12' / '<year>' values into a [start, end] date range.
	 *  Duplicated from reports/portfolio-returns — same convention as the other windowed
	 *  reports (Net Worth, Cost vs Market), each of which keeps its own copy. */
	function getPeriodRange(period: string): { startDate: string; endDate: string } {
		const toIso = (d: Date) => d.toISOString().slice(0, 10);
		const today = new Date();
		if (period === 'all') {
			return { startDate: '1900-01-01', endDate: toIso(today) };
		}
		if (period === 'last12') {
			const start = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
			return { startDate: toIso(start), endDate: toIso(today) };
		}
		const year = parseInt(period);
		const endDate = year === today.getFullYear() ? toIso(today) : `${year}-12-31`;
		return { startDate: `${year}-01-01`, endDate };
	}

	/** Computes XIRR for every listed security in one batched call (not one BQL round-trip per
	 *  security — see doc/completed-projects/portfolio-returns.md on why per-group querying
	 *  doesn't scale). */
	async function loadIrr() {
		const stocks = (data.stocks as StockSymbol[]) ?? [];
		if (stocks.length === 0) return;

		const queryFn = data.wasmQuery as CashFlowQueryFn;
		const currency = data.currency as string;
		const { startDate, endDate } = getPeriodRange(selectedPeriod);
		const periodCache = get(SecurityIrrCacheStore)?.[selectedPeriod] ?? {};

		const next: Record<string, IrrData> = {};
		for (const stock of stocks) {
			const cached = periodCache[stock.name];
			next[stock.name] = cached
				? { ...cached, loading: false }
				: { irrPct: null, irrError: null, irrHoldingDays: null, loading: true };
		}
		irrBySymbol = next;

		const uncachedStocks = stocks.filter((stock) => !periodCache[stock.name]);
		if (uncachedStocks.length === 0) return;

		const groups: InvestmentGroup[] = uncachedStocks.map((stock) => ({
			name: stock.name,
			symbols: [stock.name],
			accounts: stock.accounts
		}));

		try {
			const results = await extractAllGroupFlows(queryFn, groups, currency, startDate, endDate);
			const updated: Record<string, IrrData> = { ...irrBySymbol };
			const newCacheEntries: Record<string, Omit<IrrData, 'loading'>> = {};
			for (const stock of uncachedStocks) {
				const result = results.get(stock.name);
				if (!result) {
					updated[stock.name] = {
						irrPct: null,
						irrError: 'No data',
						irrHoldingDays: null,
						loading: false
					};
					newCacheEntries[stock.name] = { irrPct: null, irrError: 'No data', irrHoldingDays: null };
					continue;
				}
				if (result.conversionWarnings.length > 0) {
					// Same contract as reports/portfolio-returns: a price-conversion gap means some
					// flow(s)/value(s) were excluded rather than mixed into the NPV in the wrong
					// currency (see cashFlows.ts) — IRR would be computed on an incomplete series.
					const irrError = 'Unavailable: currency conversion gap';
					updated[stock.name] = { irrPct: null, irrError, irrHoldingDays: null, loading: false };
					newCacheEntries[stock.name] = { irrPct: null, irrError, irrHoldingDays: null };
					continue;
				}
				try {
					const irrPct = xirr(result.flows) * 100;
					const irrHoldingDays = holdingPeriodDays(result.flows);
					updated[stock.name] = { irrPct, irrError: null, irrHoldingDays, loading: false };
					newCacheEntries[stock.name] = { irrPct, irrError: null, irrHoldingDays };
				} catch (e) {
					const irrError = e instanceof XirrNoSolutionError ? 'Not enough activity' : String(e);
					updated[stock.name] = { irrPct: null, irrError, irrHoldingDays: null, loading: false };
					newCacheEntries[stock.name] = { irrPct: null, irrError, irrHoldingDays: null };
				}
			}
			irrBySymbol = updated;

			SecurityIrrCacheStore.update((c) => {
				const nextStore = { ...c };
				nextStore[selectedPeriod] = { ...nextStore[selectedPeriod], ...newCacheEntries };
				return nextStore;
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			const updated: Record<string, IrrData> = { ...irrBySymbol };
			for (const stock of uncachedStocks) {
				updated[stock.name] = { irrPct: null, irrError: message, irrHoldingDays: null, loading: false };
			}
			irrBySymbol = updated;
		}
	}

	function onIrrRefreshClick() {
		SecurityIrrCacheStore.update((c) => {
			if (!c) return c;
			const next = { ...c };
			delete next[selectedPeriod];
			return next;
		});
		loadIrr();
	}

	onMount(async () => {
		cursor = 'cursor-wait';
		data.stocks = await loadSecurityAnalysis(
			data.wasmQuery as QueryFn,
			data.stocks as StockSymbol[],
			(data.commodities as CommodityDirective[]) ?? []
		);
		cursor = '';
		loadIrr();
	});

	async function fetchAnalysisFor(
		queryFn: QueryFn,
		symbol: string,
		commodities: CommodityDirective[]
	): Promise<SecurityAnalysis> {
		const svc = new SecurityAnalyser(queryFn, commodities);
		const [yieldResult, gainlossResult] = await Promise.all([
			svc.getYield(symbol),
			svc.getGainLoss(symbol)
		]);
		return { yield: yieldResult, gainloss: gainlossResult };
	}

	async function loadSecurityAnalysis(
		queryFn: QueryFn,
		symbols: StockSymbol[],
		commodities: CommodityDirective[]
	): Promise<StockSymbol[]> {
		const stocksToLoad = symbols.filter((stock) => !stock.analysis);
		await processWithConcurrencyLimit(stocksToLoad, 10, async (stock) => {
			const symbol = stock.name;
			stock.loading = true;
			stock.error = undefined;
			data.stocks = [...data.stocks];
			try {
				const analysis = await fetchAnalysisFor(queryFn, symbol, commodities);
				stock.analysis = analysis;
				stock.loading = false;
				AaStocksStore.update((cache) => {
					if (!cache) return cache;
					return { ...cache, [symbol]: { ...cache[symbol], analysis } };
				});
			} catch (err) {
				console.error(`Error loading analysis for ${symbol}:`, err);
				stock.loading = false;
				stock.error = err instanceof Error ? err.message : 'Failed to load';
			}
			data.stocks = [...data.stocks];
		});
		return symbols;
	}

	// --- Lots (main view) ---

	async function loadLots(symbol: string) {
		const queryFn = data.wasmQuery as WasmQueryFn;
		const query = `SELECT account, date, position WHERE currency = '${symbol}' ORDER BY account`;
		lotsData[symbol] = { columns: [], rows: [], loading: true };
		try {
			const result = await queryFn(query);
			lotsData[symbol] = { columns: result.columns, rows: result.rows, loading: false };
		} catch (err) {
			lotsData[symbol] = {
				columns: [],
				rows: [],
				loading: false,
				error: err instanceof Error ? err.message : String(err)
			};
		}
	}

	function toggleLots(symbol: string) {
		lotsOpen[symbol] = !lotsOpen[symbol];
		if (lotsOpen[symbol] && !lotsData[symbol]) {
			loadLots(symbol);
		}
	}

	// --- Debug ---

	async function runSymbolDebugQueries(symbol: string) {
		const queryFn = data.wasmQuery as WasmQueryFn;
		const currency = data.currency as string;
		const queries = getQueries(PtaSystems.rledger);
		const yieldFrom = moment().subtract(1, 'year').format('YYYY-MM-DD');

		symbolDebug[symbol] = {
			income: null,
			value: null,
			gainLoss: null,
			costOnly: null,
			rawPositions: null,
			loading: true
		};

		try {
			const incomeQuery = queries.incomeBalance(symbol, yieldFrom, currency);
			const valueQuery = queries.valueBalance(symbol, currency);
			const gainLossQuery = queries.gainLoss(symbol, currency);
			// Isolates whether cost() or convert() is the problem
			const costOnlyQuery = `SELECT str(cost(sum(position))) as cost WHERE currency = '${symbol}'`;
			// Individual lots without aggregation
			const rawPositionsQuery = `SELECT account, position as lot WHERE currency = '${symbol}' ORDER BY account`;

			const [income, value, gainLoss, costOnly, rawPositions] = await Promise.all([
				queryFn(incomeQuery),
				queryFn(valueQuery),
				queryFn(gainLossQuery),
				queryFn(costOnlyQuery),
				queryFn(rawPositionsQuery)
			]);
			symbolDebug[symbol] = {
				income: { query: incomeQuery, ...income },
				value: { query: valueQuery, ...value },
				gainLoss: { query: gainLossQuery, ...gainLoss },
				costOnly: { query: costOnlyQuery, ...costOnly },
				rawPositions: { query: rawPositionsQuery, ...rawPositions },
				loading: false
			};
		} catch (err) {
			symbolDebug[symbol] = {
				income: null,
				value: null,
				gainLoss: null,
				costOnly: null,
				rawPositions: null,
				loading: false,
				error: err instanceof Error ? err.message : String(err)
			};
		}
	}

	async function toggleAccounts() {
		accountsOpen = !accountsOpen;
		if (accountsOpen && !rawAccountsResult) {
			const queryFn = data.wasmQuery as WasmQueryFn;
			const currency = data.currency as string;
			const rootAccount = await import('$lib/settings').then(({ settings, SettingKeys }) =>
				settings.get(SettingKeys.rootInvestmentAccount)
			);
			const accountsQuery = `SELECT account, str(value(sum(position), '${currency}')) as value,
        sum(position) as balances
		WHERE account ~ '^${rootAccount}'
		GROUP BY account
		HAVING number(value(sum(position), '${currency}')) != 0
		ORDER BY account`;
			rawAccountsResult = {
				query: accountsQuery,
				loaded: false,
				columns: [],
				rows: [],
				errors: []
			};
			try {
				const result = await queryFn(accountsQuery);
				rawAccountsResult = { query: accountsQuery, loaded: true, ...result };
			} catch (err) {
				rawAccountsResult = {
					query: accountsQuery,
					loaded: true,
					columns: [],
					rows: [],
					errors: [{ message: err instanceof Error ? err.message : String(err) }]
				};
			}
		}
	}

	function toggleSymbolDebug(symbol: string) {
		symbolDebugOpen[symbol] = !symbolDebugOpen[symbol];
		if (symbolDebugOpen[symbol] && !symbolDebug[symbol]) {
			runSymbolDebugQueries(symbol);
		}
	}

	function formatRow(row: any[]): string {
		return row
			.map((cell) => {
				if (cell == null) return 'null';
				if (typeof cell === 'object') return JSON.stringify(cell);
				return String(cell);
			})
			.join(' | ');
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Asset Class Detail"></Toolbar>
	<div class="flex items-center gap-2 px-4">
		<YearPeriodSelector bind:selectedPeriod onChange={loadIrr} includeAll />
		<button
			type="button"
			class="btn btn-square btn-ghost btn-sm"
			title="Refresh IRR (recompute this period, bypassing cache)"
			onclick={onIrrRefreshClick}
		>
			<RefreshCwIcon size={16} />
		</button>
	</div>
	<section class={`h-full p-1 ${cursor} overflow-y-auto touch-pan-y`}>
		<p>{name}</p>
		<p>Allocation: {data.assetClass?.allocation}</p>

		{#if data.stocks?.length === 0}
			<p>Loading...</p>
		{:else}
			<ul class="ms-4 mt-4">
				{#each data.stocks || [] as stock}
					<li class="mt-3">
						<h6 class="h6 flex items-center gap-2">
							• <a
								href={`/commodities/detail?symbol=${encodeURIComponent(stock.name)}`}
								class="link link-primary">{stock.name}</a
							>
							{#if stock.loading}
								<Loader class="h-4 w-4 animate-spin" />
							{/if}
						</h6>

						<!-- Analysis -->
						{#if stock.error}
							<div class="text-error ms-3 flex items-center gap-1">
								<X class="h-4 w-4" />
								<span class="text-sm">Error loading analysis: {stock.error}</span>
							</div>
		{:else if stock.analysis}
							<div class="ms-3">
								Yield <span class="text-base-content/40 text-xs">(all-time)</span>:
								<span class={Formatter.getColourForYield(stock.analysis.yield)}
									>{stock.analysis.yield}</span
								>
								Gain/Loss <span class="text-base-content/40 text-xs">(all-time)</span>:
								<span class={Formatter.getColourForGainLoss(stock.analysis.gainloss)}
									>{stock.analysis.gainloss}</span
								>
								IRR <span class="text-base-content/40 text-xs">(period)</span>:
								{#if irrBySymbol[stock.name]?.loading}
									<span class="loading loading-spinner loading-xs"></span>
								{:else if irrBySymbol[stock.name]?.irrPct !== null && irrBySymbol[stock.name]?.irrPct !== undefined}
									{@const irrData = irrBySymbol[stock.name]}
									{@const irrPct = irrData.irrPct as number}
									<span
										class="font-mono tabular-nums"
										class:text-success={irrPct >= 0}
										class:text-error={irrPct < 0}
									>
										{irrPct.toFixed(1)}%
									</span>
									{#if irrData.irrHoldingDays !== null && irrData.irrHoldingDays < SHORT_HOLDING_DAYS_THRESHOLD}
										<span class="text-base-content/40 text-xs">
											(annualized from {Math.round(irrData.irrHoldingDays)}d — short holding
											period, interpret with caution)
										</span>
									{/if}
								{:else if irrBySymbol[stock.name]?.irrError}
									<span class="text-base-content/40 text-sm"
										>{irrBySymbol[stock.name].irrError}</span
									>
								{/if}
							</div>
						{/if}

						<!-- Accounts -->
						{#each stock.accounts as account}
							<div class="ms-3">
								{account.name},
								{account.balance?.quantity}
								{account.balance?.currency},
								{account.currentValue?.toFixed(2)}
								{account.currentCurrency}
							</div>
						{/each}

						<!-- Lots -->
						<div class="ms-3 mt-1">
							<button
								class="flex items-center gap-1 text-xs opacity-60 hover:opacity-100"
								onclick={() => toggleLots(stock.name)}
							>
								{#if lotsOpen[stock.name]}
									<ChevronDown class="h-3 w-3" />
								{:else}
									<ChevronRight class="h-3 w-3" />
								{/if}
								Lots
							</button>

							{#if lotsOpen[stock.name]}
								<div class="mt-1 font-mono text-xs">
									{#if lotsData[stock.name]?.loading}
										<span class="opacity-60">Loading…</span>
									{:else if lotsData[stock.name]?.error}
										<span class="text-error">{lotsData[stock.name].error}</span>
									{:else if lotsData[stock.name]?.rows?.length}
										<table class="border-collapse">
											<thead>
												<tr class="opacity-60">
													{#each lotsData[stock.name].columns as col}
														<th class="pr-4 text-left font-normal">{col}</th>
													{/each}
												</tr>
											</thead>
											<tbody>
												{#each lotsData[stock.name].rows as row}
													<tr>
														{#each row as cell}
															<td class="pr-4">
																{typeof cell === 'object' ? JSON.stringify(cell) : cell}
															</td>
														{/each}
													</tr>
												{/each}
											</tbody>
										</table>
									{:else}
										<span class="opacity-60">No lots found</span>
									{/if}
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<!-- Debug Panel -->
		<div class="mt-6 border-t pt-4">
			<button
				class="flex items-center gap-2 text-sm font-medium opacity-60 hover:opacity-100"
				onclick={() => (debugOpen = !debugOpen)}
			>
				<Bug class="h-4 w-4" />
				Debug
				{#if debugOpen}
					<ChevronDown class="h-4 w-4" />
				{:else}
					<ChevronRight class="h-4 w-4" />
				{/if}
			</button>

			{#if debugOpen}
				<div class="mt-3 space-y-6 font-mono text-xs">
					<!-- Environment -->
					<section>
						<h3 class="mb-1 font-sans text-sm font-semibold">Environment</h3>
						<table class="border-collapse">
							<tbody>
								<tr class="border-b">
									<td class="pr-4 py-0.5 opacity-60">WASM version</td>
									<td>{data.wasmVersion}</td>
								</tr>
							</tbody>
						</table>
					</section>

					<!-- Asset Class Computed Values -->
					<section>
						<button
							class="flex items-center gap-1 font-sans text-sm font-semibold hover:opacity-80"
							onclick={() => (assetClassValuesOpen = !assetClassValuesOpen)}
						>
							{#if assetClassValuesOpen}<ChevronDown class="h-3 w-3" />{:else}<ChevronRight
									class="h-3 w-3"
								/>{/if}
							Asset Class Values
						</button>
						{#if assetClassValuesOpen && data.assetClass}
							{@const ac = data.assetClass}
							<table class="mt-1 border-collapse">
								<tbody>
									<tr class="border-b"
										><td class="pr-4 py-0.5 opacity-60">fullname</td><td>{ac.fullname}</td></tr
									>
									<tr class="border-b"
										><td class="pr-4 py-0.5 opacity-60">allocation (target %)</td><td
											>{ac.allocation}</td
										></tr
									>
									<tr class="border-b"
										><td class="pr-4 py-0.5 opacity-60">allocatedValue</td><td
											>{ac.allocatedValue?.toString()} {ac.currency}</td
										></tr
									>
									<tr class="border-b"
										><td class="pr-4 py-0.5 opacity-60">currentValue</td><td
											>{ac.currentValue?.toString()} {ac.currency}</td
										></tr
									>
									<tr class="border-b"
										><td class="pr-4 py-0.5 opacity-60">currentAllocation %</td><td
											>{ac.currentAllocation}</td
										></tr
									>
									<tr class="border-b"
										><td class="pr-4 py-0.5 opacity-60">diff (pp)</td><td>{ac.diff}</td></tr
									>
									<tr class="border-b"
										><td class="pr-4 py-0.5 opacity-60">diffAmount</td><td>{ac.diffAmount}</td></tr
									>
									<tr class="border-b"
										><td class="pr-4 py-0.5 opacity-60">diffPerc %</td><td>{ac.diffPerc}</td></tr
									>
									<tr class="border-b"
										><td class="pr-4 py-0.5 opacity-60">symbols</td><td>{ac.symbols?.join(', ')}</td
										></tr
									>
								</tbody>
							</table>
						{/if}
					</section>

					<!-- All Investment Accounts Raw -->
					<section>
						<button
							class="flex items-center gap-1 font-sans text-sm font-semibold hover:opacity-80"
							onclick={toggleAccounts}
						>
							{#if accountsOpen}<ChevronDown class="h-3 w-3" />{:else}<ChevronRight
									class="h-3 w-3"
								/>{/if}
							All Investment Accounts ({data.investmentAccounts?.length ?? 0})
						</button>
						{#if accountsOpen}
							{#if rawAccountsResult && !rawAccountsResult.loaded}
								<div class="mt-1 flex items-center gap-2 opacity-60">
									<Loader class="h-3 w-3 animate-spin" /> Loading…
								</div>
							{:else if rawAccountsResult}
								<div class="mb-2 mt-1 break-all rounded bg-gray-100 p-2 dark:bg-gray-800">
									<span class="opacity-60">Query:</span>
									{rawAccountsResult.query}
								</div>
								{#if rawAccountsResult.errors?.length}
									<div class="text-error mb-2">
										Errors: {rawAccountsResult.errors.map((e: any) => e.message).join('; ')}
									</div>
								{/if}
							{/if}
							<table class="mt-1 w-full border-collapse text-left">
								<thead>
									<tr class="border-b opacity-60">
										<th class="pr-3 py-0.5">Account</th>
										<th class="pr-3 py-0.5">Balances (raw)</th>
										<th class="pr-3 py-0.5">currentValue</th>
										<th class="py-0.5">currency</th>
									</tr>
								</thead>
								<tbody>
									{#each data.investmentAccounts ?? [] as acct}
										<tr class="border-b hover:bg-gray-50 dark:hover:bg-gray-900">
											<td class="pr-3 py-0.5">{acct.name}</td>
											<td class="pr-3 py-0.5">
												{#each Object.entries(acct.balances ?? {}) as [cur, qty]}
													<span class="mr-2">{qty} {cur}</span>
												{/each}
											</td>
											<td class="pr-3 py-0.5">{acct.currentValue}</td>
											<td class="py-0.5">{acct.currentCurrency}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
					</section>

					<!-- Per-Symbol Raw Queries -->
					<section>
						<h3 class="mb-1 font-sans text-sm font-semibold">Per-Symbol Raw Queries</h3>
						{#each data.stocks ?? [] as stock}
							<div class="mt-2 rounded border">
								<button
									class="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-gray-50 dark:hover:bg-gray-900"
									onclick={() => toggleSymbolDebug(stock.name)}
								>
									{#if symbolDebugOpen[stock.name]}
										<ChevronDown class="h-3 w-3 shrink-0" />
									{:else}
										<ChevronRight class="h-3 w-3 shrink-0" />
									{/if}
									<span class="font-semibold">{stock.name}</span>
								</button>

								{#if symbolDebugOpen[stock.name]}
									<div class="space-y-3 border-t px-2 py-2">
										{#if symbolDebug[stock.name]?.loading}
											<div class="flex items-center gap-2 opacity-60">
												<Loader class="h-3 w-3 animate-spin" /> Running queries…
											</div>
										{:else if symbolDebug[stock.name]?.error}
											<div class="text-error">{symbolDebug[stock.name].error}</div>
										{:else if symbolDebug[stock.name]}
											{@const sd = symbolDebug[stock.name]}

											{#each [{ label: 'income balance', result: sd.income }, { label: 'value balance', result: sd.value }, { label: 'gain/loss (cost + convert)', result: sd.gainLoss }, { label: 'cost only (no convert) — isolates cost() vs convert()', result: sd.costOnly }, { label: 'raw positions per lot', result: sd.rawPositions }] as { label, result }}
												<div>
													<div class="mb-0.5 opacity-60">{label}</div>
													<div class="break-all rounded bg-gray-100 p-1 dark:bg-gray-800">
														{result?.query}
													</div>
													{#if result?.errors?.length}
														<div class="text-error">
															Errors: {result.errors.map((e: any) => e.message).join('; ')}
														</div>
													{/if}
													{#if result?.rows?.length}
														<div class="mt-0.5 opacity-60">cols: {result.columns.join(', ')}</div>
														{#each result.rows as row}
															<div>{formatRow(row)}</div>
														{/each}
													{:else}
														<div class="opacity-60">— no rows —</div>
													{/if}
												</div>
											{/each}
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</section>
				</div>
			{/if}
		</div>
	</section>
</main>
