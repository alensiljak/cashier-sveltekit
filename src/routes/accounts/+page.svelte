<script lang="ts">
	import { goto } from '$app/navigation';
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import CashierDAL from '$lib/data/dal';
	import { selectionMetadata } from '$lib/data/mainStore';
	import type { Account } from '$lib/data/model';
	import { onMount } from 'svelte';

	let accounts: Array<Account> = [];
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

	async function onSearch(value: string) {
		console.log('now search for', value)
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Accounts" />
	<!-- todo: search toolbar -->
	<SearchToolbar focus onSearch={onSearch} />
	<!-- Account list -->
	<div class={`h-screen overflow-auto`}>
		{#each accounts as account}
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
