<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { xact } from '$lib/data/mainStore';
	import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let MAX_ITEMS: number = 0;

	onMount(() => {
		MAX_ITEMS = $xact.postings.length;
	});

	function onFabClicked() {
		history.back();
	}

	function onItemDownClicked(index: number) {
		if (index === MAX_ITEMS - 1) {
			// already at bottom
			return;
		}

		// Swap the item at the given index with the item above it
		[$xact.postings[index + 1], $xact.postings[index]] = [
			$xact.postings[index],
			$xact.postings[index + 1]
		];
	}

	function onItemUpClicked(index: number) {
		if (index === 0) {
			// already at top
			return;
		}

		// Swap the item at the given index with the item above it
		[$xact.postings[index - 1], $xact.postings[index]] = [
			$xact.postings[index],
			$xact.postings[index - 1]
		];
	}
</script>

<Toolbar title="Reorder Postings"></Toolbar>

<Fab Icon={CheckIcon} onclick={onFabClicked} />

<article class="p-1">
	<!-- list -->
	<div class="space-y-3 p-2">
		{#each $xact.postings as posting, i}
			<!-- posting row -->
			<div class="grid grid-cols-[1fr_auto_auto] gap-3">
				<span class="flex items-center">
					{posting.account}
				</span>
				<button
					class="preset-outlined-tertiary-500 btn-icon text-tertiary-500"
					onclick={() => onItemDownClicked(i)}
				>
					<ChevronDownIcon /></button
				>
				<button
					class="preset-outlined-tertiary-500 btn btn-icon text-tertiary-500"
					onclick={() => onItemUpClicked(i)}
				>
					<ChevronUpIcon /></button
				>
			</div>
		{/each}
	</div>
</article>
