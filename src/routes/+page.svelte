<script lang="ts">
	import GlossToolbar from '$lib/components/gloss-toolbar.svelte';
	import JournalCard from '$lib/components/JournalCard.svelte';
	import { PlusIcon } from 'lucide-svelte';
	import Toolbar from '../lib/components/Toolbar.svelte';
	import { goto } from '$app/navigation';
	import { xact } from '$lib/data/mainStore';
	import { Transaction } from '$lib/data/model';
	import FavouritesCard from '$lib/components/FavouritesCard.svelte';
	import SyncCard from '$lib/components/SyncCard.svelte';
	import ForecastCard from '$lib/components/ForecastCard.svelte';
	import ScheduledXactsCard from '$lib/components/ScheduledXactsCard.svelte';
	import { onMount } from 'svelte';
	import Fab from '$lib/components/FAB.svelte';

	let cards: Array<any> = []
	// let sortedCards = $derived(cards.sort((a, b) => a.order - b.order))

	onMount(() => {
		// display the cards ordered.
		cards = [
			{ card: SyncCard, order: 2 },
			{ card: FavouritesCard, order: 1 },
			{ card: ForecastCard, order: 3 },
			{ card: ScheduledXactsCard, order: 5 },
			{ card: JournalCard, order: 4 },
		];
		// todo: Get the array of names (ordered) and sort.
	})

	function onFab() {
		// create a new transaction in the app store
		var tx = Transaction.create();
		xact.set(tx);

		goto('/tx');
	}
</script>

<Toolbar />

<!-- Main -->
<main class="container mx-auto space-y-2 py-1 px-1 lg:max-w-screen-sm">
	<!-- Cards are displayed dynamically, in the selected order. -->
	{#each cards as { card } }
		{@render card()}
		<!-- {@const SvelteComponent = card}
		<SvelteComponent /> -->
		<!-- <svelte:component this={card} /> -->
	{/each}

	<!-- FAB -->
	 <Fab onclick={onFab} Icon={PlusIcon} />
</main>
