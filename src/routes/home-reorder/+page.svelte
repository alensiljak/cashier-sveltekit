<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import appService from '$lib/services/appService';

	let MAX_ITEMS: number = 0;

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

		MAX_ITEMS = cardNames.length;
	});

	async function onItemDownClicked(index: number) {
		if (index === MAX_ITEMS - 1) {
			console.log('already at bottom');
			return;
		}

		// Swap the item at the given index with the item above it
		[items[index + 1], items[index]] = [items[index], items[index + 1]];
	}

	async function onItemUpClicked(index: number) {
		if (index === 0) {
			console.log('already at top');
			return;
		}

		// Swap the item at the given index with the item above it
		[items[index - 1], items[index]] = [items[index], items[index - 1]];
	}

	async function onFabClicked() {
		// save settings
		let cardNames = items.map((item) => item.name);

		await settings.set(SettingKeys.visibleCards, cardNames);

		history.back();
	}
</script>

<Toolbar title="Reorder Cards" />
<Fab Icon={CheckIcon} onclick={onFabClicked} />

<section class="container space-y-2 p-1">
	{#each items as item, index (item.id)}
		<div
			class="flex h-14 flex-row items-center space-x-3 rounded-lg border
		border-tertiary-500/25 px-2"
		>
			<div class="grow">
				<span>{item.name}</span>
			</div>
			<button
				class="variant-outline-tertiary btn-icon text-tertiary-500"
				onclick={() => onItemDownClicked(index)}
			>
				<ChevronDownIcon /></button
			>
			<button
				class="variant-outline-tertiary btn btn-icon text-tertiary-500"
				onclick={() => onItemUpClicked(index)}
			>
				<ChevronUpIcon /></button
			>
		</div>
	{/each}

	<!-- <DragListReorder /> -->
</section>
