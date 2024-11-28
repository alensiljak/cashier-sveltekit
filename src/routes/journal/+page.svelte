<script lang="ts">
	import { goto } from '$app/navigation';
	import Fab from '$lib/components/FAB.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import db from '$lib/data/db';
	import { Xact } from '$lib/data/model';
	import Notifier from '$lib/utils/notifier';
	import { getModalStore, type ModalSettings } from '@skeletonlabs/skeleton';
	import { FileDownIcon, PlusIcon, TrashIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { xact } from '$lib/data/mainStore';

	const modalStore = getModalStore();
	Notifier.init();

	let xacts: Xact[] = $state([]);

	onMount(async () => {
		// load data
		await loadData();
	});

	async function loadData() {
		xacts = await db.xacts.orderBy('date').reverse().toArray();
	}

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
					await loadData();
				}
			}
		};
		modalStore.trigger(modal);
	}

	async function onExportClick() {
		await goto('/export/journal')
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
		xact.set(tx)

		goto('/xact-actions')
	}
</script>

<Toolbar title="Journal">
	{#snippet menuItems()}
		<!-- Export -->
		<ToolbarMenuItem text="Export" Icon={FileDownIcon} onclick={onExportClick} />
		<!-- Delete All -->
		<ToolbarMenuItem text="Delete All" onclick={onDeleteAllClicked} Icon={TrashIcon} />
	{/snippet}
</Toolbar>

<Fab onclick={onFab} Icon={PlusIcon} />

<main class="space-y-2 p-1">
	{#if xacts.length == 0}
		<p>The device journal is empty</p>
	{:else}
		{#each xacts as xact}
			<JournalXactRow {xact} onclick={onRowClick} />
		{/each}
	{/if}
</main>
