<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { loadImporterConfig, saveImporterConfig } from '#lib/importers/config';
	import type { ScalableConfig } from '#lib/importers/scalable/config';
	import { loadAuth, ScalableAuth } from '#lib/importers/scalable/auth';
	import { McpClient, McpError } from '#lib/importers/scalable/mcp';
	import {
		getAccountProfile,
		getPortfolioCashBreakdown,
		getPortfolioHoldings,
		getPortfolioOverview,
		getTransactionDetails,
		listAccessiblePortfolios,
		listPortfolioTransactions,
		type ScCashBreakdown,
		type ScHolding,
		type ScOverview,
		type ScPortfolio,
		type ScTransaction
	} from '#lib/importers/scalable/api';
	import { formatAmount } from '#lib/utils/formatter';
	import { formatDate } from '#lib/utils/dates';

	const PAGE_SIZE = 20;

	let connected = $state(false);
	let loading = $state(false);
	let error = $state('');
	let portfolios = $state<ScPortfolio[]>([]);
	let portfolioId = $state<string | undefined>(undefined);
	let profileName = $state('');
	let overview = $state<ScOverview | null>(null);
	let cash = $state<ScCashBreakdown | null>(null);
	let holdings = $state<ScHolding[]>([]);
	let transactions = $state<ScTransaction[]>([]);
	let nextCursor = $state<string | null>(null);
	let totalCount = $state(0);
	let loadingMore = $state(false);
	let kindFilter = $state('');
	let search = $state('');
	let openTxId = $state<string | null>(null);
	let txDetails = $state<Record<string, unknown>>({});

	let client: McpClient | null = null;

	onMount(async () => {
		connected = (await loadAuth()) !== null;
		if (!connected) return; // The template below points at the Importers page.
		const config = await loadImporterConfig<ScalableConfig>('scalable');
		client = new McpClient({ tokenSource: new ScalableAuth() });
		try {
			loading = true;
			const [profile, ps] = await Promise.all([
				getAccountProfile(client),
				listAccessiblePortfolios(client)
			]);
			profileName =
				profile.profile?.displayName ??
				[profile.profile?.firstName, profile.profile?.lastName].filter(Boolean).join(' ');
			portfolios = ps.portfolios ?? [];
			portfolioId =
				config?.portfolioId ?? ps.resolution?.autoResolvedPortfolioId ?? portfolios[0]?.portfolioId;
			await loadData();
		} catch (e) {
			error = e instanceof McpError || e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	});

	async function loadData() {
		if (!client || !portfolioId) return;
		const [o, c, h, t] = await Promise.all([
			getPortfolioOverview(client, portfolioId),
			getPortfolioCashBreakdown(client, portfolioId),
			getPortfolioHoldings(client, portfolioId),
			listPortfolioTransactions(client, { portfolioId, pageSize: PAGE_SIZE })
		]);
		overview = o;
		cash = c;
		holdings = h.holdings ?? [];
		transactions = t.transactions ?? [];
		nextCursor = t.page?.nextCursor ?? null;
		totalCount = t.page?.totalCount ?? transactions.length;
		openTxId = null;
		txDetails = {};
	}

	async function refresh() {
		if (!client) return;
		loading = true;
		error = '';
		try {
			await loadData();
		} catch (e) {
			error = e instanceof McpError || e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		if (!client || !nextCursor) return;
		loadingMore = true;
		try {
			const t = await listPortfolioTransactions(client, {
				portfolioId,
				pageSize: PAGE_SIZE,
				cursor: nextCursor
			});
			transactions = [...transactions, ...(t.transactions ?? [])];
			nextCursor = t.page?.nextCursor ?? null;
			totalCount = t.page?.totalCount ?? totalCount;
		} catch (e) {
			error = e instanceof McpError || e instanceof Error ? e.message : String(e);
		} finally {
			loadingMore = false;
		}
	}

	async function toggleTx(tx: ScTransaction) {
		if (openTxId === tx.id) {
			openTxId = null;
			return;
		}
		openTxId = tx.id;
		if (!(tx.id in txDetails) && client) {
			try {
				txDetails[tx.id] = await getTransactionDetails(client, tx.id, portfolioId);
			} catch (e) {
				txDetails[tx.id] = { error: e instanceof Error ? e.message : String(e) };
			}
		}
	}

	async function choosePortfolio(id: string) {
		portfolioId = id || undefined;
		await saveImporterConfig('scalable', { portfolioId: portfolioId } satisfies ScalableConfig);
		error = '';
		try {
			await loadData();
		} catch (e) {
			error = e instanceof McpError || e instanceof Error ? e.message : String(e);
		}
	}

	const filteredTxs = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return transactions.filter(
			(t) =>
				(!kindFilter || t.kind === kindFilter) &&
				(!q || t.description.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
		);
	});

	function txAmount(t: ScTransaction): number | null {
		const raw = t.security?.amount ?? t.cash?.amount;
		if (raw === undefined || raw === null) return null;
		const n = parseFloat(raw);
		return Number.isFinite(n) ? n : null;
	}

	function holdingGain(h: ScHolding): number | null {
		if (h.valuation === undefined || h.fifoPrice === undefined) return null;
		return h.valuation - h.fifoPrice * (h.position?.filled ?? 0);
	}

	function fmtPct(r: number): string {
		return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`;
	}

	function fmtDateTime(iso: string | undefined): string {
		if (!iso) return '';
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? iso : `${formatDate(d)} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
	}
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="Scalable Capital">
		{#snippet actions()}
			{#if connected}
				<button
					type="button"
					class="btn btn-ghost btn-circle hover-transparent h-12 w-12"
					title="Refresh"
					disabled={loading}
					onclick={refresh}
				>
					<RefreshCwIcon size={22} class={loading ? 'animate-spin' : ''} />
				</button>
			{/if}
			<HelpButton topic="importers" />
		{/snippet}
	</Toolbar>

	<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-4">
		{#if !connected}
			<div class="card bg-base-200">
				<div class="card-body p-4 gap-3">
					<p class="text-sm">
						Not connected to Scalable Capital on this device yet. Run
						<code class="font-mono text-xs">scripts/scalable_token.py</code> on your computer and paste
						the tokens on the Importers page first.
					</p>
					<a class="btn btn-primary btn-sm self-start" href="/importers">Go to Importers</a>
				</div>
			</div>
		{:else if error && !overview}
			<div class="alert alert-error text-sm">{error}</div>
			<a class="btn btn-sm self-start" href="/importers">Reconfigure</a>
		{:else}
			{#if error}<div class="alert alert-warning py-2 text-sm">{error}</div>{/if}

			{#if portfolios.length > 1}
				<label class="form-control w-full max-w-xs">
					<span class="text-sm">Portfolio</span>
					<select
						class="select select-bordered select-sm w-full"
						value={portfolioId ?? ''}
						onchange={(e) => choosePortfolio(e.currentTarget.value)}
					>
						{#each portfolios as p (p.portfolioId)}
							<option value={p.portfolioId}>{p.displayName}</option>
						{/each}
					</select>
				</label>
			{/if}

			{#if overview}
				<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
					<div class="card bg-base-200">
						<div class="card-body p-3 gap-0">
							<span class="text-xs opacity-70">Total value</span>
							<span class="text-lg font-bold">{formatAmount(overview.valuation?.total ?? 0)} EUR</span>
						</div>
					</div>
					<div class="card bg-base-200">
						<div class="card-body p-3 gap-0">
							<span class="text-xs opacity-70">Securities</span>
							<span class="text-lg font-bold">{formatAmount(overview.valuation?.securities ?? 0)} EUR</span>
						</div>
					</div>
					<div class="card bg-base-200">
						<div class="card-body p-3 gap-0">
							<span class="text-xs opacity-70">Crypto</span>
							<span class="text-lg font-bold">{formatAmount(overview.valuation?.crypto ?? 0)} EUR</span>
						</div>
					</div>
					<div class="card bg-base-200">
						<div class="card-body p-3 gap-0">
							<span class="text-xs opacity-70">Cash</span>
							<span class="text-lg font-bold">{formatAmount(cash?.cash?.cashBalance ?? 0)} EUR</span>
						</div>
					</div>
				</div>
				<p class="text-xs opacity-60">
					{profileName} · valued {fmtDateTime(overview.timestamps?.valuationTimestampUtc)}
				</p>

				{#if overview.performance?.length}
					<div class="card bg-base-200">
						<div class="card-body p-4 gap-2">
							<span class="font-medium">Performance (simple absolute return)</span>
							<div class="flex flex-wrap gap-2">
								{#each overview.performance as p (p.timeframe)}
									<div class="badge badge-lg {p.simpleAbsoluteReturn >= 0 ? 'badge-success' : 'badge-error'}">
										{p.timeframe.replaceAll('_', ' ').toLowerCase()}: {fmtPct(p.simpleAbsoluteReturn)}
									</div>
								{/each}
							</div>
						</div>
					</div>
				{/if}
			{/if}

			{#if cash}
				<div class="card bg-base-200">
					<div class="card-body p-4 gap-2">
						<span class="font-medium">Cash &amp; buying power</span>
						<div class="overflow-x-auto">
							<table class="table table-sm">
								<tbody>
									<tr><td>Cash balance</td><td class="text-right">{formatAmount(cash.cash?.cashBalance ?? 0)} EUR</td></tr>
									<tr><td>Buying power</td><td class="text-right">{formatAmount(cash.cash?.buyingPower ?? 0)} EUR</td></tr>
									<tr><td>Buying power without credit</td><td class="text-right">{formatAmount(cash.cash?.buyingPowerWithoutCredit ?? 0)} EUR</td></tr>
									<tr><td>Pending buy orders</td><td class="text-right">{formatAmount(cash.cash?.pendingBuyOrdersAmount ?? 0)} EUR</td></tr>
									<tr><td>Estimated taxes</td><td class="text-right">{formatAmount(cash.cash?.estimatedTaxes ?? 0)} EUR</td></tr>
									<tr><td>Credit line available</td><td class="text-right">{formatAmount(cash.credit?.availableCreditLine ?? 0)} EUR</td></tr>
									<tr><td>Loaned</td><td class="text-right">{formatAmount(cash.credit?.loaned ?? 0)} EUR</td></tr>
								</tbody>
							</table>
						</div>
					</div>
				</div>
			{/if}

			{#if holdings.length}
				<div class="card bg-base-200">
					<div class="card-body p-4 gap-2">
						<span class="font-medium">Holdings ({holdings.length})</span>
						<div class="overflow-x-auto">
							<table class="table table-sm">
								<thead>
									<tr>
										<th>Name</th>
										<th>ISIN</th>
										<th class="text-right">Qty</th>
										<th class="text-right">Price</th>
										<th class="text-right">Value</th>
										<th class="text-right">FIFO</th>
										<th class="text-right">Gain</th>
									</tr>
								</thead>
								<tbody>
									{#each holdings as h (h.isin)}
										{@const gain = holdingGain(h)}
										<tr>
											<td class="max-w-56 truncate" title={h.name}>{h.name}</td>
											<td class="font-mono text-xs">{h.isin}</td>
											<td class="text-right">{h.position?.filled ?? 0}</td>
											<td class="text-right">{formatAmount(h.currentQuote?.midPrice ?? 0)}</td>
											<td class="text-right">{formatAmount(h.valuation ?? 0)} {h.valuationCurrency ?? ''}</td>
											<td class="text-right">{formatAmount(h.fifoPrice ?? 0)}</td>
											<td class="text-right {gain !== null && gain < 0 ? 'text-error' : 'text-success'}">
												{gain === null ? '' : formatAmount(gain)}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			{/if}

			<div class="card bg-base-200">
				<div class="card-body p-4 gap-2">
					<div class="flex flex-wrap items-center gap-2">
						<span class="font-medium">Transactions</span>
						<span class="text-xs opacity-60">{filteredTxs.length} of {totalCount || transactions.length}</span>
						<span class="flex-1"></span>
						<select class="select select-bordered select-xs" bind:value={kindFilter}>
							<option value="">All kinds</option>
							<option value="security">Trades</option>
							<option value="cash">Cash</option>
						</select>
						<input
							class="input input-bordered input-xs w-40"
							placeholder="Search…"
							spellcheck="false"
							bind:value={search}
						/>
					</div>
					<div class="flex flex-col">
						{#each filteredTxs as t (t.id)}
							{@const amount = txAmount(t)}
							<div>
								<button
									class="flex w-full items-center gap-2 py-2 text-left hover:bg-base-300 rounded px-1"
									onclick={() => toggleTx(t)}
								>
									<span class="text-xs opacity-60 w-24 shrink-0">{fmtDateTime(t.lastEventAt).split(' ')[0]}</span>
									<span class="flex-1 min-w-0 truncate text-sm">{t.description}</span>
									<span class="badge badge-sm badge-outline">{t.category.replaceAll('_', ' ').toLowerCase()}</span>
									<span class="text-sm shrink-0 {amount !== null && amount < 0 ? 'text-error' : 'text-success'}">
										{amount === null ? '' : `${amount >= 0 ? '+' : ''}${formatAmount(amount)} ${t.currency}`}
									</span>
								</button>
								{#if openTxId === t.id}
									<div class="px-2 pb-2">
										<div class="text-xs opacity-70 mb-1">
											{t.status} · {t.id} · {t.kind}{t.isCancellation ? ' · cancellation' : ''}
										</div>
										{#if txDetails[t.id]}
											<pre class="text-xs overflow-x-auto bg-base-300 rounded p-2 max-h-72 overflow-y-auto">{JSON.stringify(txDetails[t.id], null, 2)}</pre>
										{:else}
											<span class="loading loading-spinner loading-xs"></span>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
						{#if !filteredTxs.length}
							<p class="text-sm opacity-60 py-2">No transactions loaded yet.</p>
						{/if}
					</div>
					{#if nextCursor}
						<button class="btn btn-sm self-start" disabled={loadingMore} onclick={loadMore}>
							{loadingMore ? 'Loading…' : 'Load more'}
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</main>
