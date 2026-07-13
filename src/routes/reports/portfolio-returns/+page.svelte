<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import YearPeriodSelector from '$lib/components/YearPeriodSelector.svelte';
	import { AssetAllocationEngine } from '$lib/assetAllocation/AssetAllocation';
	import type { AssetClass } from '$lib/assetAllocation/AssetClass';
	import { AssetAllocationStore, AssetAllocationLoadedAtStore } from '$lib/data/mainStore';
	import * as AccountService from '$lib/services/accountsService';
	import appService from '$lib/services/appService';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import * as OpfsLib from '$lib/utils/opfslib';
	import { SettingKeys, settings } from '$lib/settings';
	import {
		deriveInvestmentGroups,
		type InvestmentGroup
	} from '$lib/portfolioReturns/investmentGroups';
	import {
		marketValuesForGroups,
		transactionFlowsForGroups,
		buildFullFlowSeries,
		type QueryFn
	} from '$lib/portfolioReturns/cashFlows';
	import { xirr, XirrNoSolutionError, type CashFlow } from '$lib/utils/xirr';
	import { formatAmount } from '$lib/utils/formatter';
	import { CircleAlertIcon } from '@lucide/svelte';

	interface GroupRow {
		name: string;
		/** null while the market-value phase hasn't resolved yet. */
		marketValue: number | null;
		irrPct: number | null;
		/** Set when xirr() couldn't solve for this group (e.g. too little history). */
		irrError: string | null;
		conversionWarnings: string[];
		loadingMarketValue: boolean;
		loadingFlows: boolean;
	}

	interface TreeNode {
		/** This node's own segment, e.g. "Aus" for "Allocation:Equity:Aus". */
		segment: string;
		depth: number;
		children: TreeNode[];
		/** Set only on leaf nodes that are an actual reported group. */
		row?: GroupRow;
	}

	/** Nests dotted asset-class names ("Allocation:Equity:Aus:market") into a tree so the
	 *  report mirrors the Asset Allocation page's structure instead of repeating the full
	 *  path on every row. */
	function buildTree(groupRows: GroupRow[]): TreeNode[] {
		const roots: TreeNode[] = [];
		const index = new Map<string, TreeNode>();

		for (const row of groupRows) {
			const segments = row.name.split(':');
			let path = '';
			let siblings = roots;
			segments.forEach((segment, depth) => {
				path = path ? `${path}:${segment}` : segment;
				let node = index.get(path);
				if (!node) {
					node = { segment, depth, children: [] };
					index.set(path, node);
					siblings.push(node);
				}
				if (depth === segments.length - 1) node.row = row;
				siblings = node.children;
			});
		}
		return roots;
	}

	const INDENT_CLASSES = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20'];
	function indentClass(depth: number): string {
		return INDENT_CLASSES[depth] ?? INDENT_CLASSES[INDENT_CLASSES.length - 1];
	}

	let selectedPeriod = $state('last12');
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let baseCurrency = $state('');
	let rows = $state<GroupRow[]>([]);
	let tree = $derived(buildTree(rows));

	/** Mirrors YearPeriodSelector's 'last12' / '<year>' values into a [start, end] date range. */
	function getPeriodRange(period: string): { startDate: string; endDate: string } {
		const toIso = (d: Date) => d.toISOString().slice(0, 10);
		const today = new Date();
		if (period === 'all') {
			// No plausible ledger predates this; leaves openingValue at 0 so
			// buildFullFlowSeries skips the synthetic opening flow (nothing precedes it).
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

	async function loadAssetClasses(): Promise<AssetClass[]> {
		let assetClasses = get(AssetAllocationStore);
		if (assetClasses && assetClasses.length > 0) return assetClasses;

		const aaDefinitionPath = await settings.get<string>(SettingKeys.assetAllocationDefinition);
		if (!aaDefinitionPath) {
			throw new Error(
				'Asset Allocation definition not set. Configure it in Settings → Asset Allocation first.'
			);
		}
		const definition = await OpfsLib.readFile(aaDefinitionPath);
		if (!definition) {
			throw new Error(`Could not load Asset Allocation definition from ${aaDefinitionPath}.`);
		}

		const engine = new AssetAllocationEngine();
		assetClasses = await engine.loadFullAssetAllocation(definition);
		AssetAllocationStore.set(assetClasses);
		AssetAllocationLoadedAtStore.set(new Date());
		return assetClasses;
	}

	async function loadData() {
		isLoading = true;
		error = null;
		rows = [];
		await tick();

		try {
			baseCurrency = await appService.getDefaultCurrency();

			const assetClasses = await loadAssetClasses();

			await fullLedgerService.ensureLoaded();
			const queryFn: QueryFn = (bql) => fullLedgerService.query(bql);

			const investmentAccounts = await AccountService.loadInvestmentAccounts(queryFn);
			await AccountService.populateAccountBalances(investmentAccounts);

			const groups: InvestmentGroup[] = deriveInvestmentGroups(assetClasses, investmentAccounts);
			const { startDate, endDate } = getPeriodRange(selectedPeriod);

			// Render the tree immediately with per-row loading placeholders. Market value and
			// IRR stream in independently as each BQL phase resolves, instead of blocking the
			// whole page behind one spinner until every group is fully computed.
			rows = groups.map((group) => ({
				name: group.name,
				marketValue: null,
				irrPct: null,
				irrError: null,
				conversionWarnings: [],
				loadingMarketValue: true,
				loadingFlows: true
			}));
			isLoading = false;

			const rowByName = new Map(rows.map((r) => [r.name, r]));
			const pendingByName = new Map(
				groups.map((g) => [
					g.name,
					{ openingValue: 0, closingValue: 0, transactionFlows: [] as CashFlow[] }
				])
			);

			function finalizeIrr(name: string) {
				const row = rowByName.get(name);
				const pending = pendingByName.get(name);
				if (!row || !pending || row.loadingMarketValue || row.loadingFlows) return;
				const flows = buildFullFlowSeries(
					pending.transactionFlows,
					pending.openingValue,
					pending.closingValue,
					startDate,
					endDate
				);
				try {
					row.irrPct = xirr(flows) * 100;
					row.irrError = null;
				} catch (e) {
					row.irrPct = null;
					row.irrError = e instanceof XirrNoSolutionError ? 'Not enough activity' : String(e);
				}
			}

			const marketValuesDone = marketValuesForGroups(
				queryFn,
				groups,
				baseCurrency,
				startDate,
				endDate
			).then((marketValues) => {
				for (const group of groups) {
					const row = rowByName.get(group.name);
					const pending = pendingByName.get(group.name);
					const mv = marketValues.get(group.name);
					if (row && pending && mv) {
						row.marketValue = mv.closingValue;
						pending.openingValue = mv.openingValue;
						pending.closingValue = mv.closingValue;
						if (mv.conversionWarnings.length > 0) {
							row.conversionWarnings = [...row.conversionWarnings, ...mv.conversionWarnings];
						}
					}
					if (row) row.loadingMarketValue = false;
					finalizeIrr(group.name);
				}
			});

			const transactionFlowsDone = transactionFlowsForGroups(
				queryFn,
				groups,
				baseCurrency,
				startDate,
				endDate
			).then((transactionFlows) => {
				for (const group of groups) {
					const row = rowByName.get(group.name);
					const pending = pendingByName.get(group.name);
					const tf = transactionFlows.get(group.name);
					if (row && pending && tf) {
						pending.transactionFlows = tf.flows;
						if (tf.conversionWarnings.length > 0) {
							row.conversionWarnings = [...row.conversionWarnings, ...tf.conversionWarnings];
						}
					}
					if (row) row.loadingFlows = false;
					finalizeIrr(group.name);
				}
			});

			await Promise.all([marketValuesDone, transactionFlowsDone]);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			rows = [];
		} finally {
			isLoading = false;
		}
	}

	onMount(() => loadData());
</script>

<main class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Portfolio Returns" />

	<YearPeriodSelector
		bind:selectedPeriod
		onChange={() => loadData()}
		disabled={isLoading}
		includeAll
	/>

	<section class="grow overflow-y-auto touch-pan-y px-4 py-4">
		{#if isLoading}
			<div class="flex justify-center py-12">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if error}
			<div class="rounded-lg border border-error bg-error/10 p-3 text-error text-sm">
				{error}
				{#if error.includes('Asset Allocation') || error.includes('Root investment account')}
					<button
						type="button"
						class="btn btn-sm btn-outline mt-2"
						onclick={() => goto('/asset-allocation')}
					>
						Go to Asset Allocation settings
					</button>
				{/if}
			</div>
		{:else if rows.length > 0}
			<div class="flex flex-col divide-y divide-base-200">
				<div
					class="flex items-center justify-between py-2 text-xs font-medium text-base-content/50"
				>
					<span>Asset class</span>
					<span>IRR</span>
				</div>
				{#each tree as node}
					{@render treeNode(node)}
				{/each}
			</div>
		{:else}
			<div class="py-12 text-center text-base-content/50 text-sm">
				No investment groups to report. Add symbols to your Asset Allocation definition first.
			</div>
		{/if}
	</section>

	{#snippet treeNode(node: TreeNode)}
		{#if node.row}
			{@const row = node.row}
			<div class="flex items-center justify-between gap-2 py-3 {indentClass(node.depth)}">
				<div class="min-w-0">
					<div class="truncate font-medium text-sm">{node.segment}</div>
					<div class="text-xs text-base-content/60">
						{#if row.marketValue !== null}
							{formatAmount(row.marketValue)}
							{baseCurrency}
						{:else}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
					</div>
					{#if row.conversionWarnings.length > 0}
						<div class="mt-1 flex items-center gap-1 text-xs text-warning">
							<CircleAlertIcon size={12} />
							<span>{row.conversionWarnings.join('; ')}</span>
						</div>
					{/if}
				</div>
				<div class="shrink-0 text-right">
					{#if row.irrPct !== null}
						<span
							class="font-mono text-lg tabular-nums"
							class:text-success={row.irrPct >= 0}
							class:text-error={row.irrPct < 0}
						>
							{row.irrPct.toFixed(1)}%
						</span>
					{:else if row.irrError !== null}
						<span class="text-sm text-base-content/40">{row.irrError}</span>
					{:else}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
				</div>
			</div>
		{:else}
			<div
				class="py-2 text-xs font-semibold tracking-wide text-base-content/50 uppercase {indentClass(
					node.depth
				)}"
			>
				{node.segment}
			</div>
		{/if}
		{#each node.children as child}
			{@render treeNode(child)}
		{/each}
	{/snippet}
</main>
