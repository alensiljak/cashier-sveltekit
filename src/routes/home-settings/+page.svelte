<script lang="ts">
	import DragReorderList from '$lib/components/DragReorderList.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { HomeCardNames } from '$lib/enums';
	import appService from '$lib/services/appService';
	import { SettingKeys, settings } from '$lib/settings';
	import { CheckIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	const cardLabels: Record<string, string> = {
		[HomeCardNames.FAVOURITES]: 'Favourites',
		[HomeCardNames.FORECAST]: 'Financial Forecast',
		[HomeCardNames.JOURNAL]: 'Journal',
		[HomeCardNames.SCHEDULED]: 'Scheduled Transactions',
		[HomeCardNames.EXPENSES]: 'Expenses',
		[HomeCardNames.BUDGET]: 'Budget'
	};

	interface Item {
		name: string;
		visible: boolean;
	}
	let items = $state<Item[]>([]);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		const visibleCards = await appService.getVisibleCards();

		// visible cards first, in their saved order, then any remaining (hidden) cards
		const hiddenCards = Object.values(HomeCardNames).filter((name) => !visibleCards.includes(name));

		items = [...visibleCards, ...hiddenCards].map((name) => ({
			name,
			visible: visibleCards.includes(name)
		}));
	}

	async function onFabClicked() {
		const visibleCards = items.filter((item) => item.visible).map((item) => item.name);
		await settings.set(SettingKeys.visibleCards, visibleCards);
		history.back();
	}
</script>

<Toolbar title="Home Settings" />

<Fab Icon={CheckIcon} onclick={onFabClicked} />

<main class="p-1">
	<DragReorderList bind:items getLabel={(item) => cardLabels[item.name] ?? item.name} class="space-y-2 p-1 max-w-6xl mx-auto overflow-y-auto">
		{#snippet row(item)}
			<span class="grow">{cardLabels[item.name] ?? item.name}</span>
			<input class="checkbox checkbox-primary" type="checkbox" bind:checked={item.visible} aria-label="Show {cardLabels[item.name] ?? item.name}" />
		{/snippet}
	</DragReorderList>
</main>
