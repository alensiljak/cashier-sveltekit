<script lang="ts">
	import DragReorderList from '$lib/components/DragReorderList.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import { CheckIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import appService from '$lib/services/appService';

	interface Item {
		id: string;
		name: string;
	}
	let items = $state<Item[]>([]);

	onMount(async () => {
		const cardNames = await appService.getVisibleCards();
		items = cardNames.map((name: string, index: number) => ({ id: index.toString(), name }));
	});

	async function onFabClicked() {
		await settings.set(
			SettingKeys.visibleCards,
			items.map((item) => item.name)
		);
		history.back();
	}
</script>

<Toolbar title="Reorder Cards" />
<Fab Icon={CheckIcon} onclick={onFabClicked} />

<DragReorderList
	bind:items
	getLabel={(item) => item.name}
	class="space-y-2 p-1 max-w-6xl mx-auto overflow-y-auto"
/>
