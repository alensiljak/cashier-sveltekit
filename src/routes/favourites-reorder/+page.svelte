<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let _favourites = $state([]);
	let MAX_ITEMS: number = 0;

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		_favourites = await settings.get(SettingKeys.favouriteAccounts);
	}

	async function onItemDownClicked(index: number) {
		if (index === MAX_ITEMS - 1) {
			console.log('already at bottom');
			return;
		}

		// Swap the item at the given index with the item above it
		[_favourites[index + 1], _favourites[index]] = [_favourites[index], _favourites[index + 1]];
	}

	async function onItemUpClicked(index: number) {
		if (index === 0) {
			console.log('already at top');
			return;
		}

		// Swap the item at the given index with the item above it
		[_favourites[index - 1], _favourites[index]] = [_favourites[index], _favourites[index - 1]];
	}

	async function onFabClicked() {
		// save changes
		await settings.set(SettingKeys.favouriteAccounts, _favourites);

		history.back();
	}
</script>

<article>
	<Toolbar title="Reorder Favourites"></Toolbar>
	<Fab Icon={CheckIcon} onclick={onFabClicked} />

	<section class="space-y-2 p-1">
		{#each _favourites as item, index}
			<div
				class="border-tertiary-500/25 flex h-14 flex-row items-center space-x-3
				rounded-lg border-b px-2"
			>
				<div class="grow">
					<span>{item}</span>
				</div>
				<button
					class="preset-outlined-tertiary-500 btn-icon text-tertiary-500 aspect-square"
					onclick={() => onItemDownClicked(index)}
				>
					<ChevronDownIcon /></button
				>
				<button
					class="preset-outlined-tertiary-500 btn-icon text-tertiary-500 aspect-square"
					onclick={() => onItemUpClicked(index)}
				>
					<ChevronUpIcon /></button
				>
			</div>
		{/each}
	</section>
</article>
