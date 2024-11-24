<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import CashierDAL from '$lib/data/dal';
	import type { Payee } from '$lib/data/model';
	import { onMount } from 'svelte';
	import { selectionMetadata } from '$lib/data/mainStore';
	import Fab from '$lib/components/FAB.svelte';
	import { CheckIcon, SearchIcon } from 'lucide-svelte';
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';

	let payees: Array<Payee> = [];
	let isInSelectionMode = false;

	onMount(async () => {
		await loadData();

		isInSelectionMode = $selectionMetadata !== undefined;
	});

	async function loadData() {
		const dal = new CashierDAL();
		payees = await dal.loadPayees().toArray();
	}

	/**
	 * Accept the search term as the Payee.
	 */
	function onFabClick() {
		// if(string.IsNullOrWhiteSpace(searchTerm))
		// {
		//     Notification.Warning("The search term is empty!");
		//     return;
		// }
		// await onPayeeSelected(searchTerm);
	}

	function onPayeeSelected(name: string) {
		if (isInSelectionMode) {
			if ($selectionMetadata) {
				if ($selectionMetadata?.selectionType !== 'payee') {
					throw 'Invalid selection mode';
				}

				// store the selection.
				$selectionMetadata.selectedId = name;
			}

			history.back();
		} else {
			// goto('/account') // show account details
			console.info('ignore');
		}
	}

	async function onSearch(value: string) {
		console.log('now search for', value)
	}

</script>

<!-- <Fab Icon={CheckIcon} onclick={onFabClick} /> -->

<main class="flex h-screen flex-col">
	<Toolbar title="Payees" />
	<!-- search toolbar -->
	<SearchToolbar focus onSearch={onSearch} />

	<div class="h-screen overflow-auto">
		{#each payees as payee}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="border-b border-tertiary-200/15 py-2"
				onclick={() => onPayeeSelected(payee.name)}
				role="listitem"
			>
				{payee.name}
			</div>
		{/each}
	</div>
</main>
