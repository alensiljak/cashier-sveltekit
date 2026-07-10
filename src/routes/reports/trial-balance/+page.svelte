<script lang="ts">
	import { onMount } from 'svelte';
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '$lib/settings';
	import { formatAmount } from '$lib/utils/formatter';

	interface BalanceNode {
		name: string;
		fullName: string;
		depth: number;
		value: number;
		children: BalanceNode[];
		expanded: boolean;
		closed: boolean;
	}

	interface Section {
		title: string;
		prefix: string;
		roots: BalanceNode[];
		debitTotal: number;
		creditTotal: number;
	}

	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let baseCurrency = $state('');
	let asOfDate = $state(new Date().toISOString().slice(0, 10));
	let showClosed = $state(false);
	let showEmpty = $state(true);

	let assetsSection = $state<Section>({
		title: 'Assets',
		prefix: 'Assets',
		roots: [],
		debitTotal: 0,
		creditTotal: 0
	});
	let liabilitiesSection = $state<Section>({
		title: 'Liabilities',
		prefix: 'Liabilities',
		roots: [],
		debitTotal: 0,
		creditTotal: 0
	});
	let equitySection = $state<Section>({
		title: 'Equity',
		prefix: 'Equity',
		roots: [],
		debitTotal: 0,
		creditTotal: 0
	});
	let incomeSection = $state<Section>({
		title: 'Income',
		prefix: 'Income',
		roots: [],
		debitTotal: 0,
		creditTotal: 0
	});
	let expensesSection = $state<Section>({
		title: 'Expenses',
		prefix: 'Expenses',
		roots: [],
		debitTotal: 0,
		creditTotal: 0
	});

	let sections = $derived([
		assetsSection,
		liabilitiesSection,
		equitySection,
		incomeSection,
		expensesSection
	]);
	let totalDebit = $derived(sections.reduce((s, sec) => s + sec.debitTotal, 0));
	let totalCredit = $derived(sections.reduce((s, sec) => s + sec.creditTotal, 0));

	function isVisible(node: BalanceNode): boolean {
		if (node.closed && !showClosed) return false;
		if (!showEmpty && node.value === 0) return false;
		if (node.children.length > 0) return node.children.some((c) => isVisible(c));
		return true;
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

	function buildTree(rows: any[], closedAccounts: Set<string>): BalanceNode[] {
		const nodeMap = new Map<string, BalanceNode>();

		for (const row of rows) {
			const fullName = String(row[0] ?? '');
			const parts = fullName.split(':');

			nodeMap.set(fullName, {
				name: parts[parts.length - 1],
				fullName,
				depth: parts.length - 1,
				value: parseValue(row[1]),
				children: [],
				expanded: true,
				closed: closedAccounts.has(fullName)
			});

			for (let k = 1; k < parts.length; k++) {
				const ancFull = parts.slice(0, k).join(':');
				if (!nodeMap.has(ancFull)) {
					nodeMap.set(ancFull, {
						name: parts[k - 1],
						fullName: ancFull,
						depth: k - 1,
						value: 0,
						children: [],
						expanded: true,
						closed: closedAccounts.has(ancFull)
					});
				}
			}
		}

		const rootNodes: BalanceNode[] = [];
		for (const node of nodeMap.values()) {
			const parts = node.fullName.split(':');
			if (parts.length === 1) {
				rootNodes.push(node);
			} else {
				const parentFull = parts.slice(0, -1).join(':');
				nodeMap.get(parentFull)?.children.push(node);
			}
		}

		function sortChildren(nodes: BalanceNode[]) {
			nodes.sort((a, b) => a.fullName.localeCompare(b.fullName));
			for (const n of nodes) sortChildren(n.children);
		}
		sortChildren(rootNodes);

		function addTotals(node: BalanceNode) {
			for (const child of node.children) {
				addTotals(child);
				node.value += child.value;
			}
		}
		for (const root of rootNodes) addTotals(root);

		return rootNodes;
	}

	async function loadData() {
		isLoading = true;
		error = null;
		await tick();

		try {
			const currency = await settings.get<string>(SettingKeys.currency);
			baseCurrency = currency ?? 'EUR';
			await fullLedgerService.ensureLoaded();

			const closedResult = await fullLedgerService.query(
				`SELECT account FROM #accounts WHERE account ~ "^(Assets|Liabilities|Equity|Income|Expenses)" AND close IS NOT NULL`
			);
			const closedAccounts = new Set<string>();
			if (!closedResult?.errors?.length) {
				const ci = (closedResult?.columns ?? []).indexOf('account');
				if (ci !== -1) {
					for (const row of (closedResult?.rows ?? []) as any[]) {
						closedAccounts.add(String(row[ci] ?? ''));
					}
				}
			}

			// Use cost, not market value: converting at current market price (like
			// Balance Sheet does) introduces unrealized gains/losses that break the
			// fundamental double-entry identity this report exists to verify.
			const bql = `SELECT account, value(sum(cost(position)), '${baseCurrency}') as value WHERE account ~ "^(Assets|Liabilities|Equity|Income|Expenses)" AND date <= ${asOfDate} GROUP BY account ORDER BY account`;
			const result = await fullLedgerService.query(bql);

			if (result?.errors?.length) {
				error = (result.errors as any[]).map((e: any) => e.message).join('; ');
				return;
			}

			const cols = result?.columns ?? [];
			const rows = (result?.rows ?? []) as any[];
			const accountIdx = cols.indexOf('account');
			const valIdx = cols.indexOf('value');

			if (accountIdx === -1 || valIdx === -1) {
				error = 'Unexpected query result columns.';
				return;
			}

			const byPrefix: Record<string, any[]> = {
				Assets: [],
				Liabilities: [],
				Equity: [],
				Income: [],
				Expenses: []
			};

			for (const row of rows) {
				const account = String(row[accountIdx] ?? '');
				const prefix = account.split(':')[0];
				// Rows are [account, value] for buildTree's parseValue(row[1]).
				if (byPrefix[prefix]) byPrefix[prefix].push([account, row[valIdx]]);
			}

			function makeSection(title: string, prefix: string): Section {
				const roots = buildTree(byPrefix[prefix], closedAccounts);
				const total = byPrefix[prefix].reduce((s, r) => s + parseValue(r[1]), 0);
				return {
					title,
					prefix,
					roots,
					debitTotal: Math.max(total, 0),
					creditTotal: Math.max(-total, 0)
				};
			}

			assetsSection = makeSection('Assets', 'Assets');
			liabilitiesSection = makeSection('Liabilities', 'Liabilities');
			equitySection = makeSection('Equity', 'Equity');
			incomeSection = makeSection('Income', 'Income');
			expensesSection = makeSection('Expenses', 'Expenses');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => loadData());
</script>

{#snippet renderNode(node: BalanceNode)}
	{@const visChildren = node.children.filter((c) => isVisible(c))}
	{@const debit = Math.max(node.value, 0)}
	{@const credit = Math.max(-node.value, 0)}
	{#if isVisible(node)}
		{#if node.children.length > 0}
			<div>
				<button
					class="flex w-full cursor-pointer items-center gap-2 rounded py-1.5 pr-2 hover:bg-base-200"
					class:opacity-50={node.closed}
					style="padding-left: {0.5 + node.depth}rem"
					onclick={() => (node.expanded = !node.expanded)}
				>
					<span
						class="w-3 shrink-0 text-xs text-base-content/40 transition-transform"
						class:rotate-90={node.expanded}>▶</span
					>
					<span class="flex-1 text-left text-sm font-medium">{node.name}</span>
					<span class="w-24 shrink-0 text-right font-mono text-sm tabular-nums"
						>{debit ? formatAmount(debit) : ''}</span
					>
					<span class="w-24 shrink-0 text-right font-mono text-sm tabular-nums"
						>{credit ? formatAmount(credit) : ''}</span
					>
				</button>
				{#if node.expanded}
					<div>
						{#each visChildren as child}
							{@render renderNode(child)}
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<button
				class="flex w-full cursor-pointer items-center gap-2 rounded py-1.5 pr-2 hover:bg-base-200"
				class:opacity-50={node.closed}
				style="padding-left: {0.5 + node.depth}rem"
				onclick={() => goto(`/accounts/account-xacts/${encodeURIComponent(node.fullName)}`)}
			>
				<span class="w-3 shrink-0"></span>
				<span class="flex-1 text-left text-sm">{node.name}</span>
				<span class="w-24 shrink-0 text-right font-mono text-sm tabular-nums"
					>{debit ? formatAmount(debit) : ''}</span
				>
				<span class="w-24 shrink-0 text-right font-mono text-sm tabular-nums"
					>{credit ? formatAmount(credit) : ''}</span
				>
			</button>
		{/if}
	{/if}
{/snippet}

{#snippet renderSection(section: Section)}
	<div class="mb-6">
		<div class="flex items-baseline justify-between border-b border-base-300 pb-1">
			<span class="text-sm font-semibold text-base-content/70">{section.title}</span>
		</div>
		{#if section.roots.length === 0}
			<div class="py-3 text-center text-sm text-base-content/50">No accounts.</div>
		{:else}
			<div class="flex flex-col">
				{#each section.roots as root}
					{@render renderNode(root)}
				{/each}
			</div>
		{/if}
		<div
			class="flex items-baseline justify-between border-t border-base-300 pt-1 text-sm font-medium"
		>
			<span class="text-base-content/60">Total {section.title}</span>
			<span class="flex gap-0">
				<span class="w-24 shrink-0 text-right font-mono tabular-nums"
					>{section.debitTotal ? formatAmount(section.debitTotal) : ''}</span
				>
				<span class="w-24 shrink-0 text-right font-mono tabular-nums"
					>{section.creditTotal ? formatAmount(section.creditTotal) : ''}</span
				>
			</span>
		</div>
	</div>
{/snippet}

<main class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Trial Balance">
		{#snippet menuItems()}
			<label class="btn btn-primary flex w-full flex-row border-0 cursor-pointer">
				<span class="grow text-start font-normal">Show empty</span>
				<input
					type="checkbox"
					class="toggle toggle-sm"
					bind:checked={showEmpty}
					onchange={loadData}
				/>
			</label>
			<label class="btn btn-primary flex w-full flex-row border-0 cursor-pointer">
				<span class="grow text-start font-normal">Show closed</span>
				<input
					type="checkbox"
					class="toggle toggle-sm"
					bind:checked={showClosed}
					onchange={loadData}
				/>
			</label>
		{/snippet}
	</Toolbar>

	<div class="flex items-center gap-2 border-b border-base-300 px-4 py-2">
		<label for="as-of-date" class="text-sm text-base-content/60">As of</label>
		<input
			id="as-of-date"
			type="date"
			class="input input-bordered input-sm"
			bind:value={asOfDate}
			onchange={loadData}
		/>
	</div>

	<div
		class="flex items-center justify-end gap-0 border-b border-base-300 px-4 py-1 text-xs font-medium text-base-content/60"
	>
		<span class="w-24 shrink-0 text-right">Debit</span>
		<span class="w-24 shrink-0 text-right">Credit</span>
	</div>

	<section class="grow touch-pan-y overflow-y-auto px-2 py-2">
		{#if isLoading}
			<div class="flex justify-center py-12">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if error}
			<div class="rounded-lg border border-error bg-error/10 p-3 text-sm font-mono text-error">
				{error}
			</div>
		{:else}
			{@render renderSection(assetsSection)}
			{@render renderSection(liabilitiesSection)}
			{@render renderSection(equitySection)}
			{@render renderSection(incomeSection)}
			{@render renderSection(expensesSection)}

			<div
				class="flex items-baseline justify-between border-t-2 border-base-content/30 px-1 py-2 text-sm font-semibold"
			>
				<span>Total ({baseCurrency})</span>
				<span class="flex gap-0">
					<span class="w-24 shrink-0 text-right font-mono tabular-nums"
						>{formatAmount(totalDebit)}</span
					>
					<span class="w-24 shrink-0 text-right font-mono tabular-nums"
						>{formatAmount(totalCredit)}</span
					>
				</span>
			</div>
			{#if Math.round((totalDebit - totalCredit) * 100) !== 0}
				<div class="mt-1 text-right text-xs text-base-content/50">
					Difference of {formatAmount(totalDebit - totalCredit)}
					{baseCurrency} — potential unrealized FX/market-price drift.
				</div>
			{/if}
		{/if}
	</section>
</main>
