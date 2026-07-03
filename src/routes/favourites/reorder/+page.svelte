<script lang="ts">
	import DragReorderList from '$lib/components/DragReorderList.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import { CheckIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let favourites = $state<string[]>([]);

	onMount(async () => {
		favourites = (await settings.get(SettingKeys.favouriteAccounts)) ?? [];
	});

	async function onFabClicked() {
		await settings.set(SettingKeys.favouriteAccounts, favourites);
		history.back();
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Reorder Favourites" />
	<Fab Icon={CheckIcon} onclick={onFabClicked} />

	<DragReorderList
		bind:items={favourites}
		getLabel={(f) => f}
		class="grow overflow-y-auto pb-24 p-1"
	/>
</main>
