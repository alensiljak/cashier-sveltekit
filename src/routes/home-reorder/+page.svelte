<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import { CheckIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import appService from '$lib/services/appService';
	import DragListReorder from '$lib/components/DragListReorder.svelte';

	interface Item {
		id: string;
		name: string;
	}
	let items = $state<Item[]>([]);

	onMount(async () => {
		// load card names
		let cardNames = await appService.getVisibleCards();
		cardNames.forEach((name: string, index: number) => {
			items.push({ id: index.toString(), name: name });
		});
	});

	async function onFabClicked() {
		// save settings
		let cardNames = items.map((item) => item.name);

		await settings.set(SettingKeys.visibleCards, cardNames);

		history.back();
	}
</script>

<Toolbar title="Reorder Cards" />
<Fab Icon={CheckIcon} onclick={onFabClicked} />

<section class="p-1">
	<center>
		<div class="items-center">
			{#each items as item, index (item.id)}
				<div>
					{item.name}
				</div>
			{/each}
		</div>
	</center>

	<DragListReorder />
</section>
