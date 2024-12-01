<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { HomeCardNames } from '$lib/enums';
	import appService from '$lib/services/appService';
	import { SettingKeys, settings } from '$lib/settings';
	import { CheckIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';

	let visibleCards: string[] = $state([]);
	let _showFavourites = $state(false);
	let _showForecast = $state(false);
	let _showJournal = $state(false);
	let _showScheduled = $state(false);
	let _showSync = $state(false);

	onMount(async () => {
		await loadData();
	});

	/**
	 * Show the selected item.
	 * @param item The name of the card to have displayed.
	 */
	function includeItem(item: string) {
		if (!visibleCards.includes(item)) {
			visibleCards.push(item);
		}
	}

	async function loadData() {
		visibleCards = await appService.getVisibleCards();

		// check the items that are selected on the list.
		if (visibleCards.includes(HomeCardNames.FAVOURITES)) {
			_showFavourites = true;
		}
		if (visibleCards.includes(HomeCardNames.FORECAST)) {
			_showForecast = true;
		}
		if (visibleCards.includes(HomeCardNames.SYNC)) {
			_showSync = true;
		}
		if (visibleCards.includes(HomeCardNames.JOURNAL)) {
			_showJournal = true;
		}
		if (visibleCards.includes(HomeCardNames.SCHEDULED)) {
			_showScheduled = true;
		}
	}

	async function onFabClicked() {
		await saveSettings();
	}

	function removeItem(item: string): void {
		const index = visibleCards.indexOf(item);
		if (index > -1) {
			visibleCards.splice(index, 1);
		}
	}

	async function saveSettings() {
		if (_showFavourites) {
			// add if missing
			includeItem(HomeCardNames.FAVOURITES);
		} else {
			removeItem(HomeCardNames.FAVOURITES);
		}
		if (_showForecast) {
			includeItem(HomeCardNames.FORECAST);
		} else {
			removeItem(HomeCardNames.FORECAST);
		}
		if (_showJournal) {
			includeItem(HomeCardNames.JOURNAL);
		} else {
			removeItem(HomeCardNames.JOURNAL);
		}
		if (_showScheduled) {
			includeItem(HomeCardNames.SCHEDULED);
		} else {
			removeItem(HomeCardNames.SCHEDULED);
		}
		if (_showSync) {
			includeItem(HomeCardNames.SYNC);
		} else {
			removeItem(HomeCardNames.SYNC);
		}

		await settings.set(SettingKeys.visibleCards, visibleCards);

		history.back();
	}
</script>

<Toolbar title="Home Settings" />

<Fab Icon={CheckIcon} onclick={onFabClicked} />

<section class="p-1">
	<h3 class="h3">Show Cards:</h3>

	<div class="flex flex-col space-y-4 p-4">
		<label class="flex items-center space-x-2">
			<input class="checkbox" type="checkbox" bind:checked={_showFavourites} />
			<p>Favourites</p>
		</label>

		<label class="flex items-center space-x-2">
			<input class="checkbox" type="checkbox" bind:checked={_showForecast} />
			<p>Financial Forecast</p>
		</label>

		<label class="flex items-center space-x-2">
			<input class="checkbox" type="checkbox" bind:checked={_showJournal} />
			<p>Journal</p>
		</label>

		<label class="flex items-center space-x-2">
			<input class="checkbox" type="checkbox" bind:checked={_showScheduled} />
			<p>Scheduled Transactions</p>
		</label>

		<label class="flex items-center space-x-2">
			<input class="checkbox" type="checkbox" bind:checked={_showSync} />
			<p>Synchronization</p>
		</label>
	</div>
</section>
