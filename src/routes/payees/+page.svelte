<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import CashierDAL from '$lib/data/dbdal';
	import type { Payee } from '$lib/data/model';
	import { onMount } from 'svelte';
	import { selectionMetadata } from '$lib/data/mainStore';
	import Fab from '$lib/components/FAB.svelte';
	import { CheckIcon } from '@lucide/svelte';
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import { ListSearch } from '$lib/utils/ListSearch';
	import Notifier from '$lib/utils/notifier';
	import { SettingKeys, settings } from '$lib/settings';
	import { LedgerDataSource } from '$lib/enums';
	import type { DAL } from '$lib/data/dal';
	import FSDAL from '$lib/data/fsdal';

	Notifier.init();

	let payees: Array<Payee> = [];
	let filteredPayees: Array<Payee> = $state([]);
	let isInSelectionMode = $state(false);
	let searchString = $state('');
	let showFab = $derived(isInSelectionMode && searchString);


	onMount(async () => {
		await loadData();

		isInSelectionMode = $selectionMetadata !== undefined;
	});

	async function loadData() {
		document.body.style.cursor = 'wait';

		const dataSource = await settings.get(SettingKeys.ledgerDataSource) as string;
		let dal: DAL;
		if (dataSource === LedgerDataSource.filesystem) {
			dal = await FSDAL.create();
		} else {
			dal = await CashierDAL.create();
		}
		payees = await dal.loadPayees();

		filteredPayees = payees;
		
		document.body.style.cursor = 'default';
	}

	/**
	 * Accept the search term as the Payee.
	 */
	function onFabClick() {
		if (!searchString) {
			Notifier.info('The search term is empty!');
			return;
		}

		onPayeeSelected(searchString);
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
			// goto(resolve('/payee')); // todo: show payee details
		}
	}

	/**
	 * Apply filtering when the user types something in the search bar.
	 * @param value The search term
	 */
	async function onSearch(value: string) {
		// keep the search string, for showing FAB.
		searchString = value;

		if (value) {
			// Apply filter
			let search = new ListSearch();
			let regex = search.getRegex(value);

			filteredPayees = payees.filter((payee) => regex.test(payee.name));
		} else {
			// Clear filter. Use all records.
			filteredPayees = payees;
		}
	}
</script>

{#if showFab}
	<Fab Icon={CheckIcon} onclick={onFabClick} />
{/if}

<section class="flex flex-col h-full">
	<Toolbar title="Payees" />
	<!-- search toolbar -->
	<SearchToolbar focus {onSearch} />

	<div class="flex-1 overflow-y-auto px-1">
		{#each filteredPayees as payee:Payee (payee.name)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="border-base-content/15 border-b py-2 min-h-[44px] flex items-center"
				onclick={() => onPayeeSelected(payee.name)}
				role="listitem"
			>
				{payee.name || ' '}
			</div>
		{/each}
	</div>
</section>
