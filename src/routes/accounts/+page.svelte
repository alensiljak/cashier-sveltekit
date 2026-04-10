<script lang="ts">
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { selectionMetadata } from '$lib/data/mainStore';
	import { ListSearch } from '$lib/utils/ListSearch';
	import { onMount } from 'svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import type { Account } from '$lib/data/model';
	import { goto } from '$app/navigation';

	let searchTerm = $state('');
	let isInSelectionMode = $derived($selectionMetadata !== undefined);
	let allAccounts: Account[] = $state([]);
	let dataLoaded = $state(false);


	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		document.body.style.cursor = 'wait';

		await fullLedgerService.ensureLoaded();
		const accounts = await fullLedgerService.getAllAccounts();
		allAccounts = accounts as Account[];

		dataLoaded = true;
		document.body.style.cursor = 'default';
	}

	const filteredAccounts: Account[] = $derived.by(() => {
		if (!searchTerm) return allAccounts;

		const search = new ListSearch();
		const regex = search.getRegex(searchTerm);
		return allAccounts.filter((item) => regex.test(item.name ?? ''));
	});

	/**
	 * Colour the account names based on the account type.
	 */
	function getAccountColour(accountName: string | undefined): string {
		if (!accountName) {
			console.warn('Account record has undefined accountName. Please check and adjust the underlying data.');
			return '';
		}
		if (accountName.startsWith('Income:')) {
			return 'text-primary-200';
		} else if (accountName.startsWith('Expenses:')) {
			return 'text-secondary-200';
		} else if (accountName.startsWith('Assets:')) {
			return 'text-base-content';
		} else if (accountName.startsWith('Liabilities:')) {
			return 'text-purple-200';
		} else {
			return '';
		}
	}

	function onAccountSelected(name: string) {
		if (isInSelectionMode) {
			if ($selectionMetadata) {
				$selectionMetadata.selectedId = name;
			}
			history.back();
		} else {
			// navigate to account details page
			goto('/account-xacts/' + encodeURIComponent(name));
		}
	}

	function onSearch(value: string) {
		searchTerm = value;
	}
</script>

<main class="flex flex-col flex-1">
	<Toolbar title="Accounts" />
	<!-- search toolbar -->
	<SearchToolbar focus {onSearch} />
	<!-- Account list -->
	<div class="flex-1 overflow-y-auto px-1">
	{#if dataLoaded}
		{#each filteredAccounts as row, i (row.name ?? `undefined-${i}`)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="border-base-content/15 flex items-center justify-between border-b py-2 px-1 {getAccountColour(
					row.name
				)}"
				onclick={() => onAccountSelected(row.name)}
				role="listitem"
			>
				<div class="flex-1 pl-1">{row.name}</div>
				{#if row.currencies?.length}
					<span class="text-sm opacity-60 pr-1">
						{row.currencies.join(', ')}
					</span>
				{/if}
			</div>
		{/each}
	{:else}
		<div class="flex h-full items-center justify-center">
			<span class="loading loading-spinner loading-lg"></span>
		</div>
	{/if}
	</div>
</main>
