<script lang="ts">
	import { goto } from '$app/navigation';
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { selectionMetadata } from '$lib/data/mainStore';
	import type { Account } from '$lib/data/model';
	import { ListSearch } from '$lib/utils/ListSearch';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let accounts: Array<Account> = [];
	let filteredAccounts: Array<Account> = $state([]);
	let isInSelectionMode = false;

	onMount(async () => {
		accounts = data.accounts;
		filteredAccounts = accounts;

		isInSelectionMode = $selectionMetadata !== undefined;
	});

	/**
	 * Colour the account names based on the account type.
	 */
	function getAccountColour(accountName: string): string {
		if (accountName.startsWith('Income:')) {
			return 'text-primary-200';
		} else if (accountName.startsWith('Expenses:')) {
			return 'text-secondary-200';
		} else if (accountName.startsWith('Assets:')) {
			return 'text-tertiary-100';
		} else if (accountName.startsWith('Liabilities:')) {
			return 'text-purple-200';
		} else {
			return '';
		}
	}

	function onAccountSelected(name: string) {
		if (isInSelectionMode) {
			// store the selection.
			if ($selectionMetadata) {
				$selectionMetadata.selectedId = name;
			}

			history.back();
		} else {
			goto('/account'); // todo: show account details
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
				class="border-tertiary-200/15 border-b py-2 {getAccountColour(account.name)}"
				onclick={() => onAccountSelected(account.name)}
				role="listitem"
			>
				{account.name}
			</div>
		{/each}
	</div>
</main>
