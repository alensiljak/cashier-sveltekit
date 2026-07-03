<script lang="ts">
	import { onMount } from 'svelte';
	import { Trash2 } from '@lucide/svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '$lib/settings';
	import { ListSearch } from '$lib/utils/ListSearch';

	let allAccounts: string[] = $state([]);
	let hiddenAccounts: Set<string> = $state(new Set());
	let searchTerm = $state('');
	let isLoading = $state(true);

	const filteredAccounts: string[] = $derived.by(() => {
		if (!searchTerm) return allAccounts;
		const search = new ListSearch();
		const regex = search.getRegex(searchTerm);
		return allAccounts.filter((name) => regex.test(name));
	});

	const hiddenCount = $derived(hiddenAccounts.size);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		isLoading = true;
		try {
			await fullLedgerService.ensureLoaded();
			const accounts = await fullLedgerService.getAllAccounts();
			allAccounts = accounts
				.map((a) => a.name)
				.filter((name) => name.startsWith('Expenses:'))
				.sort();

			const saved = await settings.get<string[]>(SettingKeys.expensesHiddenAccounts);
			hiddenAccounts = new Set(saved ?? []);
		} finally {
			isLoading = false;
		}
	}

	function toggleAccount(name: string) {
		if (hiddenAccounts.has(name)) {
			hiddenAccounts.delete(name);
		} else {
			hiddenAccounts.add(name);
		}
		// Reassign to trigger reactivity on the Set
		hiddenAccounts = new Set(hiddenAccounts);
	}

	function clearAll() {
		hiddenAccounts = new Set();
	}

	async function saveAndGoBack() {
		await settings.set(SettingKeys.expensesHiddenAccounts, [...hiddenAccounts]);
		history.back();
	}

	function onSearch(value: string) {
		searchTerm = value;
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Expense Filter">
		{#snippet menuItems()}
			<ToolbarMenuItem text="Clear all" Icon={Trash2} onclick={clearAll} />
		{/snippet}
	</Toolbar>

	<SearchToolbar focus={false} {onSearch} />

	<!-- Hint -->
	<div class="px-4 py-2 text-xs text-base-content/50 border-b border-base-200">
		{#if hiddenCount > 0}
			{hiddenCount} account{hiddenCount === 1 ? '' : 's'} hidden from the Expenses report.
		{:else}
			Checked accounts are hidden from the Expenses report.
		{/if}
	</div>

	<!-- Account list -->
	<div class="flex-1 overflow-y-auto touch-pan-y pb-20">
		{#if isLoading}
			<div class="flex justify-center py-12">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if filteredAccounts.length === 0}
			<div class="py-12 text-center text-base-content/50 text-sm">No expense accounts found.</div>
		{:else}
			{#each filteredAccounts as account (account)}
				<label class="flex items-center gap-3 px-4 py-2.5 border-b border-base-content/10 cursor-pointer hover:bg-base-200 active:bg-base-300">
					<input
						type="checkbox"
						class="checkbox checkbox-sm"
						checked={hiddenAccounts.has(account)}
						onchange={() => toggleAccount(account)}
					/>
					<span class="text-sm flex-1">{account}</span>
				</label>
			{/each}
		{/if}
	</div>
</main>

<Fab onclick={saveAndGoBack} />
