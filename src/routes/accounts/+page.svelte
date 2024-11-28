<script lang="ts">
	import { goto } from '$app/navigation';
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import CashierDAL from '$lib/data/dal';
	import { selectionMetadata } from '$lib/data/mainStore';
	import type { Account } from '$lib/data/model';
	import { ListSearch } from '$lib/utils/ListSearch';
	import { onMount } from 'svelte';

	let accounts: Array<Account> = [];
	let filteredAccounts: Array<Account> = [];
	let isInSelectionMode = false;

	onMount(async () => {
		await loadData();

		isInSelectionMode = $selectionMetadata !== undefined;
	});

	async function loadData() {
		const dal = new CashierDAL();
		accounts = await dal.loadAccounts().toArray();
		// .sortBy('name');
		// accounts = x.toArray();

		filteredAccounts = accounts;
	}

	function onAccountSelected(name: string) {
		if (isInSelectionMode) {
			// store the selection.
			if ($selectionMetadata) {
				$selectionMetadata.selectedId = name;
			}

			history.back();
		} else {
			// goto('/account') // show account details
			console.info('redirect to account details');
		}
	}

	/**
	 * Apply filtering when the user types something in the search bar.
	 * @param value The search term
	 */
	async function onSearch(value: string) {
		if (value) {
			// Apply filter
			let search = new ListSearch();
			let regex = search.getRegex(value);

			filteredAccounts = accounts.filter((account) => regex.test(account.name));
		} else {
			// Clear filter. Use all records.
			filteredAccounts = accounts;
		}
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Accounts" />
	<!-- search toolbar -->
	<SearchToolbar focus {onSearch} />
	<!-- Account list -->
	<div class="h-screen overflow-auto p-1">
		{#each filteredAccounts as account}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="border-b border-tertiary-200/15 py-2"
				onclick={() => onAccountSelected(account.name)}
				role="listitem"
			>
				{account.name}
			</div>
		{/each}
	</div>
</main>
