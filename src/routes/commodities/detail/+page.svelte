<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import PriceHistoryChart from '$lib/components/PriceHistoryChart.svelte';
	import type { PricePoint } from '$lib/components/PriceHistoryChart.svelte';
	import { ArrowLeftRightIcon, ChevronDownIcon, ChevronRightIcon } from '@lucide/svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import appService from '$lib/services/appService';
	import { buildLotsQuery } from '$lib/services/quickQueryBuilder';
	import { formatAmount } from '$lib/utils/formatter';
	import {
		computeCommodityYield,
		commoditiesFromDirectives,
		type CommodityYieldResult
	} from '$lib/assetAllocation/commodityYield';

	type CommodityDirective = {
		currency: string;
		date: string;
		meta: Record<string, unknown>;
	};

	const symbol = $derived(decodeURIComponent(page.url.searchParams.get('symbol') ?? ''));

	let commodity: CommodityDirective | null = $state(null);
	let dataLoaded = $state(false);
	let pricePoints: PricePoint[] = $state([]);
	let lastPrice: PricePoint | null = $state(null);
	let securityYield: CommodityYieldResult | null = $state(null);
	let yieldError: string | null = $state(null);

	type LotRow = {
		date: string;
		account: string;
		quantity: string;
		price: string;
		cost: string;
		value: string;
	};
	let lotsOpen = $state(false);
	let lotsLoading = $state(false);
	let lotsLoaded = $state(false);
	let lotsError: string | null = $state(null);
	let lots: LotRow[] = $state([]);

	type AccountRow = { account: string; quantity: string; cost: string; value: string };
	let accountsOpen = $state(false);
	let accountsLoading = $state(false);
	let accountsLoaded = $state(false);
	let accountsError: string | null = $state(null);
	let accountRows: AccountRow[] = $state([]);

	let reportCurrency: string | null = null;

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		await fullLedgerService.ensureLoaded();

		// Load commodity directive
		const directives = (await fullLedgerService.getDirectives()) as any[];
		const allCommodities = commoditiesFromDirectives(directives);
		const found = directives.find((d) => d.type === 'commodity' && d.currency === symbol);
		if (found) {
			commodity = {
				currency: String(found.currency ?? ''),
				date: String(found.date ?? ''),
				meta: (found.meta as Record<string, unknown>) ?? {}
			};
		}

		if (commodity) {
			try {
				reportCurrency = await appService.getDefaultCurrency();
				securityYield = await computeCommodityYield(
					fullLedgerService.query.bind(fullLedgerService),
					commodity,
					allCommodities,
					reportCurrency
				);
			} catch (e) {
				yieldError = e instanceof Error ? e.message : String(e);
			}
		}
		// Load full price history for this symbol via BQL — runs against in-memory
		// WASM data so no disk I/O; even 5y of daily prices (~1300 rows) is sub-ms.
		const { columns, rows } = await fullLedgerService.query(
			`SELECT date, currency, amount FROM prices WHERE currency = '${symbol}' ORDER BY date`
		);
		if (rows.length > 0) {
			const dateIdx = columns.indexOf('date');
			const amtIdx = columns.indexOf('amount');
			pricePoints = (rows as any[]).flatMap((row) => {
				const rawDate = row[dateIdx];
				const rawAmt = row[amtIdx] as { number?: string | number; currency?: string } | null;
				const price = rawAmt?.number != null ? parseFloat(String(rawAmt.number)) : NaN;
				if (isNaN(price)) return [];
				const dateStr =
					typeof rawDate === 'string'
						? rawDate.slice(0, 10)
						: rawDate instanceof Date
							? rawDate.toISOString().slice(0, 10)
							: String(rawDate).slice(0, 10);
				return [{ date: dateStr, price, priceCurrency: rawAmt?.currency ?? '' }];
			});
			lastPrice = pricePoints.length > 0 ? pricePoints[pricePoints.length - 1] : null;
		}

		dataLoaded = true;
	}

	function formatLotDate(raw: unknown): string {
		if (typeof raw === 'string') return raw.slice(0, 10);
		if (raw instanceof Date) return raw.toISOString().slice(0, 10);
		return String(raw ?? '');
	}

	/** Formats amount/position/inventory shapes returned by BQL, mirroring the
	 *  cell formatting used by the Quick Query tool (util/quick-query). */
	function formatFinancialCell(value: unknown): string {
		if (value == null) return '';
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		}
		if (typeof value !== 'object') return String(value);
		const v = value as Record<string, unknown>;

		const amountStr = (number: unknown, currency: unknown): string | null => {
			if (number == null || typeof currency !== 'string') return null;
			const n = typeof number === 'string' ? parseFloat(number) : Number(number);
			return isNaN(n) ? null : `${formatAmount(n)} ${currency}`;
		};

		// Single amount: { number, currency }
		const direct = amountStr(v.number, v.currency);
		if (direct != null) return direct;

		// Position with units: { units: { number, currency }, cost?: ... }
		if (typeof v.units === 'object' && v.units !== null) {
			const units = v.units as Record<string, unknown>;
			const unitsStr = amountStr(units.number, units.currency);
			if (unitsStr != null) return unitsStr;
		}

		// Inventory: { positions: [ { units: { number, currency } } | { number, currency } ] }
		if (Array.isArray(v.positions)) {
			const parts = (v.positions as unknown[])
				.map((pos) => {
					if (typeof pos !== 'object' || pos === null) return null;
					const p = pos as Record<string, unknown>;
					if (typeof p.units === 'object' && p.units !== null) {
						const u = p.units as Record<string, unknown>;
						const s = amountStr(u.number, u.currency);
						if (s != null) return s;
					}
					return amountStr(p.number, p.currency);
				})
				.filter((s): s is string => s !== null);
			if (parts.length > 0) return parts.join(', ');
		}

		return JSON.stringify(value);
	}

	/** Like formatFinancialCell but omits the currency — used for the Qty column,
	 *  where the commodity is already implied by the page. */
	function formatQuantityCell(value: unknown): string {
		if (value == null) return '';
		if (typeof value === 'string' || typeof value === 'number') {
			const n = typeof value === 'string' ? parseFloat(value) : value;
			return isNaN(n) ? String(value) : formatAmount(n);
		}
		if (typeof value !== 'object') return String(value);
		const v = value as Record<string, unknown>;

		const numStr = (number: unknown): string | null => {
			if (number == null) return null;
			const n = typeof number === 'string' ? parseFloat(number) : Number(number);
			return isNaN(n) ? null : formatAmount(n);
		};

		const direct = numStr(v.number);
		if (direct != null) return direct;

		if (typeof v.units === 'object' && v.units !== null) {
			const units = v.units as Record<string, unknown>;
			const s = numStr(units.number);
			if (s != null) return s;
		}

		if (Array.isArray(v.positions)) {
			const parts = (v.positions as unknown[])
				.map((pos) => {
					if (typeof pos !== 'object' || pos === null) return null;
					const p = pos as Record<string, unknown>;
					if (typeof p.units === 'object' && p.units !== null) {
						const u = p.units as Record<string, unknown>;
						const s = numStr(u.number);
						if (s != null) return s;
					}
					return numStr(p.number);
				})
				.filter((s): s is string => s !== null);
			if (parts.length > 0) return parts.join(', ');
		}

		return JSON.stringify(value);
	}

	/** Pulls the currency code out of an amount/position/inventory shape, for pairing
	 *  with a bare per-unit price (cost_number) that has no currency of its own. */
	function extractCurrency(value: unknown): string {
		if (value == null || typeof value !== 'object') return '';
		const v = value as Record<string, unknown>;
		if (typeof v.currency === 'string') return v.currency;
		if (typeof v.units === 'object' && v.units !== null) {
			const units = v.units as Record<string, unknown>;
			if (typeof units.currency === 'string') return units.currency;
		}
		if (Array.isArray(v.positions) && v.positions.length > 0) {
			const p = v.positions[0] as Record<string, unknown>;
			if (typeof p.currency === 'string') return p.currency;
			if (typeof p.units === 'object' && p.units !== null) {
				const units = p.units as Record<string, unknown>;
				if (typeof units.currency === 'string') return units.currency;
			}
		}
		return '';
	}

	/** Formats the per-unit lot price (a bare cost_number), tagging it with the
	 *  currency taken from the lot's cost total (same cost_currency per lot). */
	function formatPriceCell(priceRaw: unknown, costRaw: unknown): string {
		if (priceRaw == null) return '';
		const n = typeof priceRaw === 'string' ? parseFloat(priceRaw) : Number(priceRaw);
		if (isNaN(n)) return '';
		const currency = extractCurrency(costRaw);
		return currency ? `${formatAmount(n)} ${currency}` : formatAmount(n);
	}

	/** Loads only currently-held (live) lots: grouped by account/cost, quantity > 0. */
	async function loadLots() {
		lotsLoading = true;
		lotsError = null;
		try {
			const query = buildLotsQuery({
				account: [],
				currency: [symbol],
				exchange: reportCurrency ?? undefined,
				average: false,
				active: true,
				showAll: false,
				closed: false
			});
			const { columns, rows } = await fullLedgerService.query(query);
			const dateIdx = columns.indexOf('date');
			const accountIdx = columns.indexOf('account');
			const quantityIdx = columns.indexOf('quantity');
			const priceIdx = columns.indexOf('price');
			const costIdx = columns.indexOf('cost');
			const valueIdx =
				columns.indexOf('converted_value') >= 0
					? columns.indexOf('converted_value')
					: columns.indexOf('value');
			lots = (rows as unknown[][]).map((row) => ({
				date: formatLotDate(row[dateIdx]),
				account: String(row[accountIdx] ?? ''),
				quantity: formatQuantityCell(row[quantityIdx]),
				price: formatPriceCell(row[priceIdx], row[costIdx]),
				cost: formatFinancialCell(row[costIdx]),
				value: formatFinancialCell(row[valueIdx])
			}));
		} catch (e) {
			lotsError = e instanceof Error ? e.message : String(e);
		} finally {
			lotsLoading = false;
			lotsLoaded = true;
		}
	}

	async function toggleLots() {
		lotsOpen = !lotsOpen;
		if (lotsOpen && !lotsLoaded) {
			await loadLots();
		}
	}

	/** Loads accounts currently holding this commodity, aggregated across all lots (average cost). */
	async function loadAccounts() {
		accountsLoading = true;
		accountsError = null;
		try {
			const query = buildLotsQuery({
				account: [],
				currency: [symbol],
				exchange: reportCurrency ?? undefined,
				average: true,
				active: false,
				showAll: false,
				closed: false
			});
			const { columns, rows } = await fullLedgerService.query(query);
			const accountIdx = columns.indexOf('account');
			const quantityIdx = columns.indexOf('quantity');
			const costIdx = columns.indexOf('total_cost');
			const valueIdx =
				columns.indexOf('converted_value') >= 0
					? columns.indexOf('converted_value')
					: columns.indexOf('value');
			accountRows = (rows as unknown[][]).map((row) => ({
				account: String(row[accountIdx] ?? ''),
				quantity: formatQuantityCell(row[quantityIdx]),
				cost: formatFinancialCell(row[costIdx]),
				value: formatFinancialCell(row[valueIdx])
			}));
		} catch (e) {
			accountsError = e instanceof Error ? e.message : String(e);
		} finally {
			accountsLoading = false;
			accountsLoaded = true;
		}
	}

	async function toggleAccounts() {
		accountsOpen = !accountsOpen;
		if (accountsOpen && !accountsLoaded) {
			await loadAccounts();
		}
	}

	/** Internal Beancount metadata keys to skip in the UI. */
	const SKIP_META_KEYS = new Set(['filename', 'lineno']);

	function visibleMeta(meta: Record<string, unknown>): [string, unknown][] {
		return Object.entries(meta).filter(([k]) => !SKIP_META_KEYS.has(k));
	}

	function formatMetaValue(value: unknown): string {
		if (value === null || value === undefined) return '';
		if (typeof value === 'string') return value;
		if (typeof value === 'boolean' || typeof value === 'number') return String(value);
		if (typeof value === 'object' && 'number' in (value as Record<string, unknown>)) {
			const v = value as { number: string; currency: string };
			return `${v.number} ${v.currency}`;
		}
		return JSON.stringify(value);
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Commodity">
		{#snippet actions()}
			<HelpButton topic="commodity-detail" />
		{/snippet}
		{#snippet menuItems()}
			<ToolbarMenuItem
				text="Currency Converter"
				Icon={ArrowLeftRightIcon}
				onclick={() => goto(`/currency-converter?from=${encodeURIComponent(symbol)}`)}
			/>
		{/snippet}
	</Toolbar>
	<section class="flex-1 overflow-y-auto touch-pan-y p-4">
		{#if !dataLoaded}
			<div class="flex h-full items-center justify-center">
				<span class="loading loading-spinner loading-lg"></span>
			</div>
		{:else if !commodity}
			<div class="flex h-full flex-col items-center justify-center gap-2 opacity-50">
				<p class="font-mono text-4xl font-bold">{symbol}</p>
				<p class="text-sm">No commodity directive found.</p>
			</div>
		{:else}
			<!-- Central heading -->
			<div class="mb-8 flex flex-col items-center gap-1 pt-6 text-center">
				<h1 class="font-mono text-5xl font-bold tracking-widest">{commodity.currency}</h1>
				{#if typeof commodity.meta?.name === 'string'}
					<p class="mt-2 text-lg opacity-75">{commodity.meta.name}</p>
				{/if}
				<p class="mt-1 text-xs opacity-40">Declared {commodity.date}</p>
			</div>

			<!-- Last price box -->
			{#if lastPrice}
				<div class="mx-auto max-w-2xl mt-4 overflow-hidden rounded-xl bg-base-100 shadow">
					<div class="flex items-center justify-between px-4 py-3">
						<span class="text-sm font-medium opacity-50">Last price</span>
						<div class="text-right">
							<span class="font-mono font-semibold">
								{lastPrice.price.toLocaleString(undefined, {
									minimumFractionDigits: 2,
									maximumFractionDigits: 4
								})}
								{lastPrice.priceCurrency}
							</span>
							<span class="ml-2 text-xs opacity-40">{lastPrice.date}</span>
						</div>
					</div>
				</div>
			{/if}

			<!-- Yield (TTM) box — linked via isin/ticker metadata when declared -->
			{#if securityYield}
				<div class="mx-auto max-w-2xl mt-4 overflow-hidden rounded-xl bg-base-100 shadow">
					<div class="flex items-center justify-between px-4 py-3">
						<span class="text-sm font-medium opacity-50">Yield (TTM)</span>
						<span class="font-mono font-semibold">{securityYield.yieldPct}</span>
					</div>
					<div class="flex items-center justify-between border-t border-base-content/10 px-4 py-2">
						<span class="text-xs opacity-40">Linked by</span>
						<span class="text-xs opacity-60">
							{securityYield.matchedBy === 'symbol'
								? 'currency code (no isin/ticker meta)'
								: securityYield.matchedBy}
							{#if securityYield.linkedCurrencies.length > 1}
								&nbsp;({securityYield.linkedCurrencies.join(', ')})
							{/if}
						</span>
					</div>
				</div>
			{:else if yieldError}
				<div class="mx-auto max-w-2xl mt-4 overflow-hidden rounded-xl bg-base-100 shadow px-4 py-3">
					<span class="text-xs text-error">Yield unavailable: {yieldError}</span>
				</div>
			{/if}

			<!-- Metadata table -->
			{#if visibleMeta(commodity.meta).length > 0}
				<div class="mx-auto max-w-2xl mt-4 overflow-hidden rounded-xl bg-base-100 shadow">
					{#each visibleMeta(commodity.meta) as [key, value], i (key)}
						<div
							class="flex items-start justify-between px-4 py-3 {i > 0
								? 'border-t border-base-content/10'
								: ''}"
						>
							<span class="shrink-0 text-sm font-medium opacity-50">{key}</span>
							<span class="ml-4 text-right text-sm break-all">{formatMetaValue(value)}</span>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Price history chart -->
			{#if pricePoints.length > 0}
				<div class="mx-auto max-w-2xl mt-6 overflow-hidden rounded-xl bg-base-100 shadow p-3">
					<p class="text-xs font-medium opacity-50 mb-1 px-1">Price history</p>
					<PriceHistoryChart points={pricePoints} priceCurrency={lastPrice?.priceCurrency ?? ''} />
				</div>
			{/if}

			<!-- Accounts holding this commodity (live positions only) -->
			<div class="mx-auto max-w-2xl mt-4 overflow-hidden rounded-xl bg-base-100 shadow">
				<button
					class="flex w-full items-center justify-between px-4 py-3"
					onclick={toggleAccounts}
					aria-expanded={accountsOpen}
				>
					<span class="text-sm font-medium opacity-50">Accounts</span>
					{#if accountsOpen}
						<ChevronDownIcon class="h-4 w-4 opacity-40" />
					{:else}
						<ChevronRightIcon class="h-4 w-4 opacity-40" />
					{/if}
				</button>
				{#if accountsOpen}
					<div class="border-t border-base-content/10 px-4 py-3">
						{#if accountsLoading}
							<div class="flex justify-center py-2">
								<span class="loading loading-spinner loading-sm"></span>
							</div>
						{:else if accountsError}
							<span class="text-xs text-error">{accountsError}</span>
						{:else if accountRows.length === 0}
							<span class="text-xs opacity-50">No accounts currently hold this commodity</span>
						{:else}
							<div class="overflow-x-auto">
								<table class="table table-sm">
									<thead>
										<tr>
											<th class="text-xs font-normal opacity-50">Account</th>
											<th class="text-right text-xs font-normal opacity-50">Qty</th>
											<th class="text-right text-xs font-normal opacity-50">Cost</th>
											<th class="text-right text-xs font-normal opacity-50">Value</th>
										</tr>
									</thead>
									<tbody>
										{#each accountRows as row}
											<tr>
												<td class="text-xs break-all">
													<a
														href={`/accounts/account-xacts/${encodeURIComponent(row.account)}`}
														class="link link-hover"
													>
														{row.account}
													</a>
												</td>
												<td class="text-right text-xs whitespace-nowrap">{row.quantity}</td>
												<td class="text-right text-xs whitespace-nowrap">{row.cost}</td>
												<td class="text-right text-xs whitespace-nowrap">{row.value}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Lots (live positions only) -->
			<div class="mx-auto max-w-2xl mt-4 overflow-hidden rounded-xl bg-base-100 shadow">
				<button
					class="flex w-full items-center justify-between px-4 py-3"
					onclick={toggleLots}
					aria-expanded={lotsOpen}
				>
					<span class="text-sm font-medium opacity-50">Lots</span>
					{#if lotsOpen}
						<ChevronDownIcon class="h-4 w-4 opacity-40" />
					{:else}
						<ChevronRightIcon class="h-4 w-4 opacity-40" />
					{/if}
				</button>
				{#if lotsOpen}
					<div class="border-t border-base-content/10 px-4 py-3">
						{#if lotsLoading}
							<div class="flex justify-center py-2">
								<span class="loading loading-spinner loading-sm"></span>
							</div>
						{:else if lotsError}
							<span class="text-xs text-error">{lotsError}</span>
						{:else if lots.length === 0}
							<span class="text-xs opacity-50">No live lots held</span>
						{:else}
							<div class="overflow-x-auto">
								<table class="table table-sm">
									<thead>
										<tr>
											<th class="text-xs font-normal opacity-50">Date</th>
											<th class="text-xs font-normal opacity-50">Account</th>
											<th class="text-right text-xs font-normal opacity-50">Qty</th>
											<th class="text-right text-xs font-normal opacity-50">Price</th>
											<th class="text-right text-xs font-normal opacity-50">Cost</th>
											<th class="text-right text-xs font-normal opacity-50">Value</th>
										</tr>
									</thead>
									<tbody>
										{#each lots as lot}
											<tr>
												<td class="whitespace-nowrap text-xs">{lot.date}</td>
												<td class="text-xs break-all">{lot.account}</td>
												<td class="text-right text-xs whitespace-nowrap">{lot.quantity}</td>
												<td class="text-right text-xs whitespace-nowrap">{lot.price}</td>
												<td class="text-right text-xs whitespace-nowrap">{lot.cost}</td>
												<td class="text-right text-xs whitespace-nowrap">{lot.value}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</section>
</main>
