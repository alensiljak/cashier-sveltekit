<script lang="ts">
	import GlossToolbar from '$lib/components/gloss-toolbar.svelte';
	import JournalCard from '$lib/components/JournalCard.svelte';
	import { ArrowDownUpIcon, PlusIcon, SettingsIcon } from 'lucide-svelte';
	import Toolbar from '../lib/components/Toolbar.svelte';
	import { goto } from '$app/navigation';
	import { xact } from '$lib/data/mainStore';
	import { Xact } from '$lib/data/model';
	import FavouritesCard from '$lib/components/FavouritesCard.svelte';
	import SyncCard from '$lib/components/SyncCard.svelte';
	import ForecastCard from '$lib/components/ForecastCard.svelte';
	import ScheduledXactsCard from '$lib/components/ScheduledXactsCard.svelte';
	import { onMount, type Component } from 'svelte';
	import Fab from '$lib/components/FAB.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { CardNames } from '$lib/settings';
	import appService from '$lib/services/appService';

	let cards: Array<Component> = $state([]);
	let cardsOrder = $state([]);

	onMount(async () => {
		// display the cards ordered.
		await loadCardList();
	});

	async function loadCardList() {
		let cardsOrder = await appService.getVisibleCards();

		cardsOrder.forEach((name: string) => {
			let card;
			switch (name) {
				case CardNames.FavouritesCard:
					card = FavouritesCard;
					break;
				case CardNames.ForecastCard:
					card = ForecastCard;
					break;
				case CardNames.JournalCard:
					card = JournalCard;
					break;
				case CardNames.ScheduledXactCard:
					card = ScheduledXactsCard;
					break;
				case CardNames.SyncCard:
					card = SyncCard;
					break;
			}
			if (card) {
				cards.push(card);
			}
		});
	}

	async function onFab() {
		// create a new transaction in the app store
		var tx = Xact.create();
		xact.set(tx);

		await goto('/tx');
	}
</script>

<Toolbar>
	{#snippet menuItems()}
		<ToolbarMenuItem text="Home Settings" Icon={SettingsIcon} targetNav="/home-settings" />
		<ToolbarMenuItem text="Reorder Cards" targetNav="/home-reorder" Icon={ArrowDownUpIcon} />
		{/snippet}
</Toolbar>

<!-- Main -->
<main class="container mx-auto space-y-2 px-1 py-1 lg:max-w-screen-sm">
	<!-- Cards are displayed dynamically, in the selected order. -->
	{#each cards as Card}
		 <Card></Card>
	{/each}

	<!-- FAB -->
	<Fab onclick={onFab} Icon={PlusIcon} />
</main>
