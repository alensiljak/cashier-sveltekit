<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import { CheckIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { draggable, droppable, type DragDropState } from '@thisux/sveltednd';
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import { goto } from '$app/navigation';

	interface Item {
		id: string;
		name: string;
	}
	let items = $state<Item[]>([]);

	onMount(async () => {
		// load card names
		let cardNames = await settings.get(SettingKeys.visibleCards);
		cardNames.forEach((name: string, i: string) => {
			items.push({ id: i.toString(), name: name });
		});
	});

	/**
	 * Handle drops between containers
	 * @param state
	 */
	function handleDrop(state: DragDropState<Item>) {
		// const { draggedItem, sourceContainer, targetContainer } = state;
		// if (!targetContainer || sourceContainer === targetContainer) return;
		const { draggedItem, targetContainer } = state;
		const dragIndex = items.findIndex((item: Item) => item.id === draggedItem.id);
		const dropIndex = parseInt(targetContainer ?? '0');

		if (dragIndex !== -1 && !isNaN(dropIndex)) {
			const [item] = items.splice(dragIndex, 1);
			items.splice(dropIndex, 0, item);
		}
	}

	async function onFabClicked() {
		// save settings
		let cardNames = items.map(item => item.name);
		
		await settings.set(SettingKeys.visibleCards, cardNames)

		history.back()
	}
</script>

<Toolbar title="Reorder Cards" />
<Fab Icon={CheckIcon} onclick={onFabClicked} />

<section class="p-1">
	<center>
	<div class="items-center">
			<div class="space-y-3">
				{#each items as item, index (item.id)}
					<div
						use:draggable={{ container: index.toString(), dragData: item }}
						use:droppable={{
							container: index.toString(),
							callbacks: { onDrop: handleDrop }
						}}
						animate:flip={{ duration: 200 }}
						in:fade={{ duration: 150 }}
						out:fade={{ duration: 150 }}
						class="svelte-dnd-touch-feedback cursor-move rounded-lg bg-primary-400 
							   p-3 shadow-sm ring-1 ring-gray-200 
							   transition-all duration-200 
							   hover:shadow-md hover:ring-2 hover:ring-secondary-200"
					>
						<div class="mb-2 flex items-start justify-between gap-2">
							<h3 class="font-medium text-gray-900">
								{item.name}
							</h3>
						</div>
					</div>
				{/each}
			</div>
	</div>
</center>
</section>
