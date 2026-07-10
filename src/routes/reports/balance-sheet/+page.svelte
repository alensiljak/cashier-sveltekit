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
	}

	interface Section {
		title: string;
		prefix: string;
		roots: BalanceNode[];
		total: number;
	}

	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let baseCurrency = $state('');
	let asOfDate = $state(new Date().toISOString().slice(0, 10));

	let assetsSection = $state<Section>({ title: 'Assets', prefix: 'Assets', roots: [], total: 0 });
	let liabilitiesSection = $state<Section>({
		title: 'Liabilities',
		prefix: 'Liabilities',
		roots: [],
		total: 0
	});
	let equitySection = $state<Section>({ title: 'Equity', prefix: 'Equity', roots: [], total: 0 });

	// Assets − Liabilities − Equity: undistributed current-period earnings,
	// since Income/Expenses aren't closed into Equity until the book is closed.
	let currentEarnings = $derived(
		assetsSection.total - liabilitiesSection.total - equitySection.total
	);

	function parseValue(raw: unknown): number {
		if (raw == null) return 0;
		if (typeof raw === 'object' && (raw as any).number != null) {
			return parseFloat((raw as any).number) || 0;
		}
		const str = String(raw).trim();
		const match = str.match(/^([−-]?[\d,]*\.?\d+)\s+\S+$/);
		return match ? parseFloat(match[1].replace(/,/g, '').replace('−', '-')) || 0 : 0;
	}

	function buildTree(rows: { account: string; value: number }[]): BalanceNode[] {
		const nodeMap = new Map<string, BalanceNode>();

		for (const { account: fullName, value } of rows) {
			const parts = fullName.split(':');

			nodeMap.set(fullName, {
				name: parts[parts.length - 1],
				fullName,
				depth: parts.length - 1,
				value,
				children: [],
				expanded: true
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
						expanded: true
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

			const bql = `SELECT account, value(sum(position), '${baseCurrency}') as value WHERE account ~ "^(Assets|Liabilities|Equity)" AND date <= ${asOfDate} GROUP BY account ORDER BY account`;
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

			const byPrefix: Record<string, { account: string; value: number }[]> = {
				Assets: [],
				Liabilities: [],
				Equity: []
			};

			for (const row of rows) {
				const account = String(row[accountIdx] ?? '');
				const value = parseValue(row[valIdx]);
				const prefix = account.split(':')[0];
				if (byPrefix[prefix]) byPrefix[prefix].push({ account, value });
			}

			assetsSection = {
				title: 'Assets',
				prefix: 'Assets',
				roots: buildTree(byPrefix.Assets),
				total: byPrefix.Assets.reduce((s, r) => s + r.value, 0)
			};
			liabilitiesSection = {
				title: 'Liabilities',
				prefix: 'Liabilities',
				roots: buildTree(byPrefix.Liabilities),
				total: byPrefix.Liabilities.reduce((s, r) => s + r.value, 0)
			};
			equitySection = {
				title: 'Equity',
				prefix: 'Equity',
				roots: buildTree(byPrefix.Equity),
				total: byPrefix.Equity.reduce((s, r) => s + r.value, 0)
			};
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => loadData());
</script>

{#snippet renderNode(node: BalanceNode)}
	{#if node.children.length > 0}
		<div>
			<button
				class="flex w-full cursor-pointer items-center gap-2 rounded py-1.5 pr-2 hover:bg-base-200"
				style="padding-left: {0.5 + node.depth}rem"
				onclick={() => (node.expanded = !node.expanded)}
			>
				<span
					class="w-3 shrink-0 text-xs text-base-content/40 transition-transform"
					class:rotate-90={node.expanded}
				>▶</span>
				<span class="flex-1 text-left text-sm font-medium">{node.name}</span>
				<span class="font-mono text-sm tabular-nums">{formatAmount(node.value)}&nbsp;{baseCurrency}</span>
			</button>
			{#if node.expanded}
				<div>
					{#each node.children as child}
						{@render renderNode(child)}
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<button
			class="flex w-full cursor-pointer items-center gap-2 rounded py-1.5 pr-2 hover:bg-base-200"
			style="padding-left: {0.5 + node.depth}rem"
			onclick={() => goto(`/accounts/account-xacts/${encodeURIComponent(node.fullName)}`)}
		>
			<span class="w-3 shrink-0"></span>
			<span class="flex-1 text-left text-sm">{node.name}</span>
			<span class="font-mono text-sm tabular-nums">{formatAmount(node.value)}&nbsp;{baseCurrency}</span>
		</button>
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
		<div class="flex items-baseline justify-between border-t border-base-300 pt-1 text-sm font-medium">
			<span class="text-base-content/60">Total {section.title}</span>
			<span class="font-mono tabular-nums">{formatAmount(section.total)}&nbsp;{baseCurrency}</span>
		</div>
	</div>
{/snippet}

<main class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Balance Sheet" />

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

			<div class="flex items-baseline justify-between px-1 py-1 text-sm">
				<span class="text-base-content/60">Current Earnings</span>
				<span class="font-mono tabular-nums">{formatAmount(currentEarnings)}&nbsp;{baseCurrency}</span>
			</div>
		{/if}
	</section>
</main>
