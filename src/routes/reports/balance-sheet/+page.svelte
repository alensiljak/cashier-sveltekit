<script lang="ts">
	import { onMount } from 'svelte';
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '$lib/settings';
	import { formatAmount } from '$lib/utils/formatter';
	import PillToggle from '$lib/components/PillToggle.svelte';
	import MultiCurrencyBalance from '$lib/components/MultiCurrencyBalance.svelte';

	interface BalanceNode {
		name: string;
		fullName: string;
		depth: number;
		value: number;
		position: Record<string, number>;
		children: BalanceNode[];
		expanded: boolean;
		closed: boolean;
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
	let showClosed = $state(false);
	let currencyMode = $state<'original' | 'base'>('base');
	let showBase = $derived(currencyMode === 'base');
	let showEmpty = $state(true);

	let assetsSection = $state<Section>({ title: 'Assets', prefix: 'Assets', roots: [], total: 0 });
	let liabilitiesSection = $state<Section>({
		title: 'Liabilities',
		prefix: 'Liabilities',
		roots: [],
		total: 0
	});
	let equitySection = $state<Section>({ title: 'Equity', prefix: 'Equity', roots: [], total: 0 });

	function isVisible(node: BalanceNode): boolean {
		if (node.closed && !showClosed) return false;
		if (!showEmpty && node.value === 0) return false;
		if (node.children.length > 0) return node.children.some((c) => isVisible(c));
		return true;
	}

	// Assets − Liabilities − Equity: undistributed current-period earnings,
	// since Income/Expenses aren't closed into Equity until the book is closed.
	let currentEarnings = $derived(
		assetsSection.total - liabilitiesSection.total - equitySection.total
	);

	function parsePosition(raw: any): Record<string, number> {
		const pos: Record<string, number> = {};
		if (!raw?.positions) return pos;
		for (const p of raw.positions) {
			const cur = p.units?.currency ?? '';
			const num = parseFloat(p.units?.number ?? '0') || 0;
			if (cur) pos[cur] = (pos[cur] ?? 0) + num;
		}
		return pos;
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
				position: parsePosition(row[1]),
				value: parseValue(row[2]),
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
						position: {},
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
				for (const [cur, amt] of Object.entries(child.position)) {
					node.position[cur] = (node.position[cur] ?? 0) + amt;
				}
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

			// Query for closed accounts
			const closedResult = await fullLedgerService.query(
				`SELECT account FROM #accounts WHERE account ~ "^(Assets|Liabilities|Equity)" AND close IS NOT NULL`
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

			const bql = `SELECT account, sum(position) as position, value(sum(position), '${baseCurrency}') as value WHERE account ~ "^(Assets|Liabilities|Equity)" AND date <= ${asOfDate} GROUP BY account ORDER BY account`;
			const result = await fullLedgerService.query(bql);

			if (result?.errors?.length) {
				error = (result.errors as any[]).map((e: any) => e.message).join('; ');
				return;
			}

			const cols = result?.columns ?? [];
			const rows = (result?.rows ?? []) as any[];
			const accountIdx = cols.indexOf('account');
			const posIdx = cols.indexOf('position');
			const valIdx = cols.indexOf('value');

			if (accountIdx === -1 || posIdx === -1 || valIdx === -1) {
				error = 'Unexpected query result columns.';
				return;
			}

			const byPrefix: Record<string, any[]> = {
				Assets: [],
				Liabilities: [],
				Equity: []
			};

			for (const row of rows) {
				const account = String(row[accountIdx] ?? '');
				const prefix = account.split(':')[0];
				if (byPrefix[prefix]) byPrefix[prefix].push(row);
			}

			assetsSection = {
				title: 'Assets',
				prefix: 'Assets',
				roots: buildTree(byPrefix.Assets, closedAccounts),
				total: byPrefix.Assets.reduce((s, r) => s + parseValue(r[2]), 0)
			};
			liabilitiesSection = {
				title: 'Liabilities',
				prefix: 'Liabilities',
				roots: buildTree(byPrefix.Liabilities, closedAccounts),
				total: byPrefix.Liabilities.reduce((s, r) => s + parseValue(r[2]), 0)
			};
			equitySection = {
				title: 'Equity',
				prefix: 'Equity',
				roots: buildTree(byPrefix.Equity, closedAccounts),
				total: byPrefix.Equity.reduce((s, r) => s + parseValue(r[2]), 0)
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
	{@const visChildren = node.children.filter((c) => isVisible(c))}
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
						class:rotate-90={node.expanded}
					>▶</span>
					<span class="flex-1 text-left text-sm font-medium">{node.name}</span>
					{#if showBase}
						<span class="font-mono text-sm tabular-nums">{formatAmount(node.value)}&nbsp;{baseCurrency}</span>
					{:else}
						<MultiCurrencyBalance
							balances={node.position}
							defaultCurrency={baseCurrency}
							loaded={true}
							class="text-sm"
						/>
					{/if}
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
				{#if showBase}
					<span class="font-mono text-sm tabular-nums">{formatAmount(node.value)}&nbsp;{baseCurrency}</span>
				{:else}
					<MultiCurrencyBalance
						balances={node.position}
						defaultCurrency={baseCurrency}
						loaded={true}
						class="text-sm"
					/>
				{/if}
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
		<div class="flex items-baseline justify-between border-t border-base-300 pt-1 text-sm font-medium">
			<span class="text-base-content/60">Total {section.title}</span>
			<span class="font-mono tabular-nums">{formatAmount(section.total)}&nbsp;{baseCurrency}</span>
		</div>
	</div>
{/snippet}

<main class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Balance Sheet">
		{#snippet menuItems()}
			<label class="btn btn-primary flex w-full flex-row border-0 cursor-pointer">
				<span class="grow text-start font-normal">Show empty</span>
				<input type="checkbox" class="toggle toggle-sm bg-transparent bg-none" bind:checked={showEmpty} onchange={loadData} />
			</label>
			<label class="btn btn-primary flex w-full flex-row border-0 cursor-pointer">
				<span class="grow text-start font-normal">Show closed</span>
				<input type="checkbox" class="toggle toggle-sm bg-transparent bg-none" bind:checked={showClosed} onchange={loadData} />
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

	<div class="flex items-center border-b border-base-300 px-4 py-2">
		<PillToggle
			bind:value={currencyMode}
			options={[
				{ value: 'original', label: 'Original' },
				{ value: 'base', label: baseCurrency || 'Base' }
			]}
			class="ml-auto"
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
