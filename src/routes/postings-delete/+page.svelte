<script lang="ts">
	import { goto } from '$app/navigation';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { xact } from '$lib/data/mainStore';
	import type { Posting } from '$lib/data/model';
	import { getModalStore, type ModalSettings } from '@skeletonlabs/skeleton';
	import { CheckIcon, TrashIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';

	const modalStore = getModalStore();

	// let _postings: Posting[] = $state([]);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		// _postings = $xact.postings;
	}

	function onDeleteClicked(index: number) {
		// confirm dialog
		const modal: ModalSettings = {
			type: 'confirm',
			// Data
			title: 'Confirm Delete',
			body: 'Do you want to delete the selected posting?',
			response: (r: boolean) => {
				if (r) {
					$xact.postings.splice(index, 1);
					// fix for the binding
					$xact.postings = $xact.postings;
					// _postings.splice(index, 1);
					// _postings = $xact.postings;
				}
			}
		};
		modalStore.trigger(modal);
	}

	function onFabClicked() {
		history.back();
	}
</script>

<Toolbar title="Delete Postings"></Toolbar>

<Fab Icon={CheckIcon} onclick={onFabClicked} />

<article class="p-1">
	<div class="space-y-3 py-3">
		{#each $xact.postings as posting, i}
			<div class="flex flex-row">
				<span class="flex grow items-center">
					{posting.account}
				</span>
				<button
					class="variant-ringed btn-icon mr-2 text-secondary-500"
					onclick={() => onDeleteClicked(i)}
				>
					<TrashIcon />
				</button>
			</div>
		{/each}
	</div>
</article>
