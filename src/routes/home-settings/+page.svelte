<script lang="ts">
	import { goto } from '$app/navigation';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { HomeCardNames } from '$lib/enums';
	import appService from '$lib/services/appService';
	import { SettingKeys, settings } from '$lib/settings';
	import { CheckIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';

	let _showFavourites = $state(false);
	let _showForecast = $state(false);
	let _showJournal = $state(false);
	let _showScheduled = $state(false);
	let _showSync = $state(false);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		let visibleCardNames = await appService.getVisibleCards();

		// check the items that are selected on the list.
		if (visibleCardNames.includes(HomeCardNames.FAVOURITES)) {
			_showFavourites = true;
		}
		if (visibleCardNames.includes(HomeCardNames.FORECAST)) {
			_showForecast = true;
		}
		if (visibleCardNames.includes(HomeCardNames.SYNC)) {
			_showSync = true;
		}
		if (visibleCardNames.includes(HomeCardNames.JOURNAL)) {
			_showJournal = true;
		}
		if (visibleCardNames.includes(HomeCardNames.SCHEDULED)) {
			_showScheduled = true;
		}
	}

	async function onFabClicked() {
		await saveSettings();
	}

	async function saveSettings() {
		let visibleCardNames = []
		if(_showFavourites) {
			visibleCardNames.push(HomeCardNames.FAVOURITES)
		}
		if(_showForecast) {
			visibleCardNames.push(HomeCardNames.FORECAST)
		}
		if(_showJournal) {
			visibleCardNames.push(HomeCardNames.JOURNAL)
		}
		if(_showScheduled) {
			visibleCardNames.push(HomeCardNames.SCHEDULED)
		}
		if(_showSync) {
			visibleCardNames.push(HomeCardNames.SYNC)
		}

		await settings.set(SettingKeys.visibleCards, visibleCardNames)

		await goto('/')
	}
</script>

<Toolbar title="Home Settings">
	{#snippet menuItems()}
		<ToolbarMenuItem text="Reorder Cards" targetNav="/home-reorder" />
	{/snippet}
</Toolbar>

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
