<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { onMount } from 'svelte';
	import { selectionMetadata } from '$lib/data/mainStore';
	import Fab from '$lib/components/FAB.svelte';
	import { CheckIcon } from '@lucide/svelte';
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import { ListSearch } from '$lib/utils/ListSearch';
	import Notifier from '$lib/utils/notifier';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';

	Notifier.init();

	let payees: string[] = [];
	let filteredPayees: string[] = $state([]);
	let isInSelectionMode = $state(false);
	let searchString = $state('');
	let showFab = $derived(isInSelectionMode && searchString);
	let dataLoaded = $state(false);


	onMount(async () => {
		await loadData();

		isInSelectionMode = $selectionMetadata !== undefined;
	});

	async function loadData() {
		document.body.style.cursor = 'wait';

		await fullLedgerService.ensureLoaded();
		const result = await fullLedgerService.query(
			'SELECT DISTINCT COALESCE(payee, narration) as payee FROM transactions ORDER BY payee'
		);

		const payeeIdx = result.columns.indexOf('payee');
		payees = result.rows.map((row: any) => row[payeeIdx] as string);

		filteredPayees = payees;

		dataLoaded = true;
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

			filteredPayees = payees.filter((payee) => regex.test(payee));
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
	{#if !dataLoaded}
		<div class="flex h-full items-center justify-center">
			<span class="loading loading-spinner loading-lg"></span>
		</div>
	{:else}
		{#each filteredPayees as payee (payee)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="border-base-content/15 border-b py-2 min-h-[44px] flex items-center"
				onclick={() => onPayeeSelected(payee)}
				role="listitem"
			>
				{payee || ' '}
			</div>
		{/each}
	{/if}
	</div>
</section>
