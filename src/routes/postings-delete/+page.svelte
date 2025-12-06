<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { xact } from '$lib/data/mainStore';
	import { CheckIcon, TrashIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {Posting, Xact} from '$lib/data/model'

	let isDeleteConfirmationOpen = $state(false);
	let indexToDelete = -1;

	onMount(async () => {
		if (!$xact) {
			goto('/');
			return;
		}
	});

	/**
	 * Close all dialogs.
	 */
	function closeModal() {
		isDeleteConfirmationOpen = false;
	}

	function onDeleteClicked(index: number) {
		// confirm dialog
		indexToDelete = index;
		isDeleteConfirmationOpen = true;
	}

	async function onDeleteConfirmed() {
		closeModal();

		const newPostings = $xact.postings.filter((_: Posting, i: number) => i !== indexToDelete);

		xact.update((current: Xact) => ({
			...current,
			postings: newPostings
		}));
	}

	function onFabClicked() {
		history.back();
	}
</script>

<Toolbar title="Delete Postings"></Toolbar>

<Fab Icon={CheckIcon} onclick={onFabClicked} />

<article class="p-1">
	<!-- list -->
	<div class="space-y-3 py-3">
		{#if $xact}
			{#each $xact.postings as posting: Posting, i (posting)}
				<!-- posting row -->
				<div class="flex flex-row">
					<span class="flex grow items-center">
						{posting.account}
					</span>
					<button
						class="preset-outlined btn-icon text-secondary-500 mr-2"
						onclick={() => onDeleteClicked(i)}
					>
						<TrashIcon />
					</button>
				</div>
			{/each}
		{/if}
	</div>
</article>

<!-- "Delete All" dialog -->
<input type="checkbox" id="delete-posting-confirmation-modal" class="modal-toggle" bind:checked={isDeleteConfirmationOpen} />
<div class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Delete</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">Do you want to delete the selected posting?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary text-tertiary-500"
				onclick={onDeleteConfirmed}>OK</button
			>
		</footer>
	</div>
</div>
