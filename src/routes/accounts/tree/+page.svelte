<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronDown, ChevronRight, CoinsIcon } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import MultiCurrencyBalance from '$lib/components/MultiCurrencyBalance.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import appService from '$lib/services/appService';
	import HelpButton from '$lib/help/HelpButton.svelte';

	interface TreeNode {
		name: string;
		label: string;
		level: number;
		children: string[];
		balances: Record<string, number>;
	}

	let nodeMap = $state(new Map<string, TreeNode>());
	let rootNames: string[] = $state([]);
	let expandedNodes = $state(new Set<string>());
	let dataLoaded = $state(false);
	let defaultCurrency = $state('');
	let showBaseCurrency = $state(false);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		document.body.style.cursor = 'wait';
		await fullLedgerService.ensureLoaded();

		defaultCurrency = await appService.getDefaultCurrency();

		const allAccounts = await fullLedgerService.getAllAccounts();

		const balanceExpr = showBaseCurrency
			? `convert(sum(position), '${defaultCurrency}')`
			: 'sum(position)';
		const result = await fullLedgerService.query(
			`SELECT account, ${balanceExpr} AS balance`
		);
		const accountIdx = result.columns.indexOf('account');
		const balanceIdx = result.columns.indexOf('balance');

		const balanceMap = new Map<string, Record<string, number>>();
		for (const row of result.rows as any[][]) {
			const name = row[accountIdx] as string;
			if (name) balanceMap.set(name, extractBalances(row[balanceIdx]));
		}

		const map = new Map<string, TreeNode>();
		for (const acc of allAccounts) {
			ensureNode(acc.name, map);
		}

		// Assign own balances
		for (const [name, balances] of balanceMap) {
			const node = map.get(name);
			if (node) {
				for (const [cur, amt] of Object.entries(balances)) {
					node.balances[cur] = (node.balances[cur] ?? 0) + amt;
				}
			}
		}

		// Aggregate balances bottom-up (deepest nodes first)
		const sorted = [...map.keys()].sort((a, b) => b.split(':').length - a.split(':').length);
		for (const name of sorted) {
			const parts = name.split(':');
			if (parts.length < 2) continue;
			const parentName = parts.slice(0, -1).join(':');
			const parent = map.get(parentName);
			const node = map.get(name)!;
			if (parent) {
				for (const [cur, amt] of Object.entries(node.balances)) {
					parent.balances[cur] = (parent.balances[cur] ?? 0) + amt;
				}
			}
		}

		nodeMap = map;
		rootNames = [...map.keys()].filter((n) => !n.includes(':')).sort();
		expandedNodes = new Set(rootNames);
		dataLoaded = true;
		document.body.style.cursor = 'default';
	}

	function ensureNode(fullName: string, map: Map<string, TreeNode>) {
		if (map.has(fullName)) return;
		const parts = fullName.split(':');
		map.set(fullName, {
			name: fullName,
			label: parts[parts.length - 1],
			level: parts.length - 1,
			children: [],
			balances: {}
		});
		if (parts.length > 1) {
			const parentName = parts.slice(0, -1).join(':');
			ensureNode(parentName, map);
			const parent = map.get(parentName)!;
			if (!parent.children.includes(fullName)) {
				parent.children.push(fullName);
			}
		}
	}

	function extractBalances(cell: any): Record<string, number> {
		const out: Record<string, number> = {};
		if (!cell || typeof cell !== 'object') return out;
		if (Array.isArray(cell.positions)) {
			for (const pos of cell.positions) {
				if (pos?.units?.currency && pos.units.number != null)
					out[pos.units.currency] = (out[pos.units.currency] ?? 0) + parseFloat(pos.units.number);
			}
			return out;
		}
		if (cell.units?.currency && cell.units.number != null) {
			out[cell.units.currency] = parseFloat(cell.units.number);
			return out;
		}
		if (cell.currency && cell.number != null) out[cell.currency] = parseFloat(cell.number);
		return out;
	}

	async function toggleBaseCurrency() {
		showBaseCurrency = !showBaseCurrency;
		dataLoaded = false;
		await loadData();
	}

	function toggleNode(name: string) {
		const node = nodeMap.get(name);
		if (node && node.children.length > 0) {
			const next = new Set(expandedNodes);
			if (next.has(name)) {
				next.delete(name);
			} else {
				next.add(name);
			}
			expandedNodes = next;
		}
	}


	function getAccountTypeColour(name: string): string {
		const root = name.split(':')[0];
		if (root === 'Income') return 'text-primary-200';
		if (root === 'Expenses') return 'text-secondary-200';
		if (root === 'Liabilities') return 'text-purple-200';
		return '';
	}

	let visibleNodes: TreeNode[] = $derived.by(() => {
		const result: TreeNode[] = [];
		function walk(names: string[]) {
			for (const name of [...names].sort()) {
				const node = nodeMap.get(name);
				if (!node) continue;
				result.push(node);
				if (expandedNodes.has(name)) walk(node.children);
			}
		}
		walk(rootNames);
		return result;
	});
</script>

<main class="flex flex-col flex-1">
	<Toolbar title="Account Tree">
		{#snippet actions()}
			<HelpButton topic="account-tree" />
		{/snippet}
		{#snippet menuItems()}
			<ToolbarMenuItem
				text={showBaseCurrency ? 'Show original balances' : 'Show balances in base currency'}
				Icon={CoinsIcon}
				onclick={toggleBaseCurrency}
			/>
		{/snippet}
	</Toolbar>
	<div class="flex-1 overflow-y-auto overflow-x-auto touch-pan-y">
		{#if dataLoaded}
			<div class="min-w-max">
				{#each visibleNodes as node (node.name)}
					<div class="border-b border-base-content/15 {getAccountTypeColour(node.name)}">
						<div
							class="w-full flex items-start py-1.5"
							style="padding-left: {node.level * 1.25 + 0.25}rem"
						>
							<button
								class="w-5 h-5 flex items-center justify-center shrink-0 mr-1 rounded hover:bg-base-300"
								onclick={() => toggleNode(node.name)}
								tabindex={node.children.length > 0 ? 0 : -1}
								aria-label={expandedNodes.has(node.name) ? 'Collapse' : 'Expand'}
							>
								{#if node.children.length > 0}
									{#if expandedNodes.has(node.name)}
										<ChevronDown class="w-4 h-4 opacity-60" />
									{:else}
										<ChevronRight class="w-4 h-4 opacity-60" />
									{/if}
								{/if}
							</button>
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span
								class="flex-1 whitespace-nowrap cursor-pointer {node.level === 0 ? 'font-semibold' : ''}"
								onclick={() => goto('/accounts/account-xacts/' + encodeURIComponent(node.name))}
							>
								{node.label}
							</span>
							<MultiCurrencyBalance
								balances={node.balances}
								defaultCurrency={defaultCurrency}
								loaded={true}
								class="text-sm pr-2 shrink-0"
							/>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="flex h-full items-center justify-center">
				<span class="loading loading-spinner loading-lg"></span>
			</div>
		{/if}
	</div>
</main>
