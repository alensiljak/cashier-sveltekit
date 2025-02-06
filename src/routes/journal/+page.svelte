<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Fab from '$lib/components/FAB.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import db from '$lib/data/db';
	import { Xact } from '$lib/data/model';
	import Notifier from '$lib/utils/notifier';
	import { Modal } from '@skeletonlabs/skeleton-svelte';
	import { FileDownIcon, ImportIcon, PlusIcon, TrashIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { xact } from '$lib/data/mainStore';
	import type { PageData } from './$types';

	Notifier.init();
	let isDeleteAllConfirmationOpen = $state(false);

	let listContainer: any;
	let { data }: { data: PageData } = $props();

	onMount(async () => {
		// Scroll to the end of the list
		// window.scrollTo({
		// 	top: document.body.scrollHeight,
		// 	behavior: 'smooth'
		// });
		listContainer.scrollTop = listContainer.scrollHeight;
	});

	/**
	 * Close all dialogs.
	 */
	function closeModal() {
		isDeleteAllConfirmationOpen = false;
	}

	async function onDeleteAllClicked() {
		// show confirmation dialog
		isDeleteAllConfirmationOpen = true;
	}

	async function onDeleteAllConfirmed() {
		closeModal();

		// delete all Xacts
		await db.xacts.clear();
		Notifier.success('All local transactions deleted.');
		// Reload data.
		await invalidateAll();
	}

	async function onExportClick() {
		await goto('/export/journal');
	}

	async function onFab() {
		// create a new transaction in the app store
		var tx = Xact.create();
		xact.set(tx);

		await goto('/tx');
	}

	/**
	 * When the Xact row is clicked, open the details page.
	 * @param tx
	 */
	async function onRowClick(tx: Xact) {
		// store into state
		xact.set(tx);

		goto('/xact-actions');
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Journal">
		{#snippet menuItems()}
			<!-- Export -->
			<ToolbarMenuItem text="Export" Icon={FileDownIcon} onclick={onExportClick} />
			<!-- Delete All -->
			<ToolbarMenuItem text="Delete All" onclick={onDeleteAllClicked} Icon={TrashIcon} />
			<ToolbarMenuItem
				text="Import Ledger item"
				Icon={ImportIcon}
				targetNav="/import-ledger-xact"
			/>
		{/snippet}
	</Toolbar>

	<section class="grow space-y-2 overflow-auto p-1 pb-3" bind:this={listContainer}>
		{#if data.xacts?.length == 0}
			<p>The device journal is empty</p>
		{:else}
			{#each data.xacts as xact}
				<JournalXactRow {xact} onclick={onRowClick} />
			{/each}
		{/if}
	</section>

	<Fab onclick={onFab} Icon={PlusIcon} />
</article>

<!-- "Delete All" dialog -->
<Modal
	bind:open={isDeleteAllConfirmationOpen}
	triggerBase="hidden"
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-screen-sm"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet trigger()}Open Modal{/snippet}
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h4">Confirm Delete</h2>
		</header>
		<article>
			<p class="opacity-60">Do you want to delete all transactions?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="variant-tonal btn" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn-primary variant-filled-primary btn text-tertiary-500"
				onclick={onDeleteAllConfirmed}>OK</button
			>
		</footer>
	{/snippet}
</Modal>
