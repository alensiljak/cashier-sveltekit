<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { xact } from '$lib/data/mainStore';
	import { Modal } from '@skeletonlabs/skeleton-svelte';
	import { CheckIcon, TrashIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';
	let isDeleteConfirmationOpen = $state(false);
	let indexToDelete = -1;

	onMount(async () => {});

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

		$xact.postings.splice(indexToDelete, 1);
		// fix for the binding
		$xact.postings = $xact.postings;
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
		{#each $xact.postings as posting, i}
			<!-- posting row -->
			<div class="flex flex-row">
				<span class="flex grow items-center">
					{posting.account}
				</span>
				<button
					class="preset-outlined btn-icon mr-2 text-secondary-500"
					onclick={() => onDeleteClicked(i)}
				>
					<TrashIcon />
				</button>
			</div>
		{/each}
	</div>
</article>

<!-- "Delete All" dialog -->
<Modal
	open={isDeleteConfirmationOpen}
	triggerBase="hidden"
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-(--breakpoint-sm)"
	backdropClasses="backdrop-blur-xs"
>
	{#snippet trigger()}Open Modal{/snippet}
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h4">Confirm Delete</h2>
		</header>
		<article>
			<p class="opacity-60">Do you want to delete the selected posting?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="variant-tonal btn" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn-primary preset-filled-primary-500 btn text-tertiary-500"
				onclick={onDeleteConfirmed}>OK</button
			>
		</footer>
	{/snippet}
</Modal>
