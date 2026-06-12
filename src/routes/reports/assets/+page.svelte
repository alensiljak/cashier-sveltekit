<script lang="ts">
	import { onMount } from 'svelte';
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import MultiCurrencyBalance from '$lib/components/MultiCurrencyBalance.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '$lib/settings';
	import { formatAmount } from '$lib/utils/formatter';
	import PillToggle from '$lib/components/PillToggle.svelte';

	interface AssetNode {
		name: string;
		fullName: string;
		depth: number;
		position: Record<string, number>;
		value: number;
		children: AssetNode[];
		expanded: boolean;
		closed: boolean;
	}

	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let roots = $state<AssetNode[]>([]);
	let currencyMode = $state<'original' | 'base'>('base');
	let showBase = $derived(currencyMode === 'base');
	let baseCurrency = $state('');
	let showClosed = $state(false);
	let hideEmpty = $state(false);

	let totalValue = $derived(roots.reduce((s, n) => s + n.value, 0));

	function isVisible(node: AssetNode): boolean {
		if (node.closed && !showClosed) return false;
		if (hideEmpty && node.value === 0) return false;
		if (node.children.length > 0) return node.children.some((c) => isVisible(c));
		return true;
	}

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

	function parseValue(raw: any): number {
		if (raw == null) return 0;
		if (typeof raw === 'object' && raw.number != null) return parseFloat(raw.number) || 0;
		const str = String(raw).trim();
		const match = str.match(/^([−-]?[\d,]*\.?\d+)\s+\S+$/);
		return match ? parseFloat(match[1].replace(/,/g, '').replace('−', '-')) || 0 : 0;
	}

	function buildTree(
		rows: any[],
		accountIdx: number,
		posIdx: number,
		valIdx: number,
		closedAccounts: Set<string>
	): AssetNode[] {
		const nodeMap = new Map<string, AssetNode>();

		for (const row of rows) {
			const fullName = String(row[accountIdx] ?? '');
			const parts = fullName.split(':');

			nodeMap.set(fullName, {
				name: parts[parts.length - 1],
				fullName,
				depth: parts.length - 1,
				position: parsePosition(row[posIdx]),
				value: parseValue(row[valIdx]),
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

		const rootNodes: AssetNode[] = [];
		for (const node of nodeMap.values()) {
			const parts = node.fullName.split(':');
			if (parts.length === 1) {
				rootNodes.push(node);
			} else {
				const parentFull = parts.slice(0, -1).join(':');
				nodeMap.get(parentFull)?.children.push(node);
			}
		}

		function sortChildren(nodes: AssetNode[]) {
			nodes.sort((a, b) => a.fullName.localeCompare(b.fullName));
			for (const n of nodes) sortChildren(n.children);
		}
		sortChildren(rootNodes);

		function addTotals(node: AssetNode) {
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

			const bql = `SELECT account, sum(position) as position, value(sum(position), '${baseCurrency}') as value WHERE account ~ "^Assets" GROUP BY account ORDER BY account`;
			const result = await fullLedgerService.query(bql);

			if (result?.errors?.length) {
				error = (result.errors as any[]).map((e: any) => e.message).join('; ');
				return;
			}

			const closedResult = await fullLedgerService.query(
				`SELECT account FROM #accounts WHERE account ~ "^Assets" AND close IS NOT NULL`
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

			const cols = result?.columns ?? [];
			const rows = result?.rows ?? [];
			const accountIdx = cols.indexOf('account');
			const posIdx = cols.indexOf('position');
			const valIdx = cols.indexOf('value');

			if (accountIdx === -1 || posIdx === -1) {
				error = 'Unexpected query result columns.';
				return;
			}

			roots = buildTree(rows as any[], accountIdx, posIdx, valIdx, closedAccounts);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => loadData());
</script>

{#snippet renderNode(node: AssetNode)}
	{@const visChildren = node.children.filter((c) => isVisible(c))}
	{#if isVisible(node)}
		{#if visChildren.length > 0}
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
						<span class="font-mono text-sm tabular-nums"
							>{formatAmount(node.value)}&nbsp;{baseCurrency}</span
						>
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
					<span class="font-mono text-sm tabular-nums"
						>{formatAmount(node.value)}&nbsp;{baseCurrency}</span
					>
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

<article class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Assets">
		{#snippet menuItems()}
			<label class="btn btn-primary flex w-full flex-row border-0 cursor-pointer">
				<span class="grow text-start font-normal">Hide empty</span>
				<input type="checkbox" class="toggle toggle-sm" bind:checked={hideEmpty} />
			</label>
			<label class="btn btn-primary flex w-full flex-row border-0 cursor-pointer">
				<span class="grow text-start font-normal">Show closed</span>
				<input type="checkbox" class="toggle toggle-sm" bind:checked={showClosed} />
			</label>
		{/snippet}
	</Toolbar>

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
		{:else if roots.length === 0}
			<div class="py-12 text-center text-sm text-base-content/50">No asset accounts found.</div>
		{:else}
			<div class="flex flex-col">
				{#each roots as root}
					{@render renderNode(root)}
				{/each}
			</div>
		{/if}
	</section>

	{#if showBase && roots.length > 0 && !isLoading}
		<div class="flex justify-end border-t border-base-300 px-4 py-2 text-sm font-medium">
			<span class="mr-2 text-base-content/60">Total:</span>
			<span class="font-mono tabular-nums">{formatAmount(totalValue)}&nbsp;{baseCurrency}</span>
		</div>
	{/if}
</article>
