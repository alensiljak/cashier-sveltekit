<script lang="ts">
	import { goto, invalidate, invalidateAll } from '$app/navigation';
	import Fab from '$lib/components/FAB.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import db from '$lib/data/db';
	import { Xact } from '$lib/data/model';
	import Notifier from '$lib/utils/notifier';
	import { getModalStore, type ModalSettings } from '@skeletonlabs/skeleton';
	import { FileDownIcon, ImportIcon, PlusIcon, TrashIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { xact } from '$lib/data/mainStore';
	import type { PageData } from './$types';

	const modalStore = getModalStore();
	Notifier.init();

	let listContainer: any;
	let { data }: { data: PageData } = $props();
	let xacts: Xact[] = data.xacts;

	onMount(async () => {
		// Scroll to the end of the list
		// window.scrollTo({
		// 	top: document.body.scrollHeight,
		// 	behavior: 'smooth'
		// });
		listContainer.scrollTop = listContainer.scrollHeight;
	});

	async function onDeleteAllClicked() {
		// show confirmation dialog
		const modal: ModalSettings = {
			type: 'confirm',
			// Data
			title: 'Confirm Delete',
			body: 'Do you want to delete all transactions?',
			response: async (r: boolean) => {
				if (r) {
					// delete all Xacts
					await db.xacts.clear();
					Notifier.success('All local transactions deleted.');
					// Reload data.
					await invalidateAll();
				}
			}
		};
		modalStore.trigger(modal);
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
		{#if xacts?.length == 0}
			<p>The device journal is empty</p>
		{:else}
			{#each xacts as xact}
				<JournalXactRow {xact} onclick={onRowClick} />
			{/each}
		{/if}
	</section>

	<Fab onclick={onFab} Icon={PlusIcon} />
</article>
