<script lang="ts">
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import Fab from '$lib/components/FAB.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { Xact } from '$lib/data/model';
	import { xact, xactSpan } from '$lib/data/mainStore';
	import ledgerService from '$lib/services/ledgerService';
	import type { DirectiveSpan } from '$lib/rledger/sourceEditor';
	import * as opfslib from '$lib/utils/opfslib';
	import { CashierFilename } from '$lib/constants';
	import Notifier from '$lib/utils/notifier';
	import { FileDownIcon, ImportIcon, PlusIcon, TrashIcon } from '@lucide/svelte';

	Notifier.init();

	let isDeleteAllConfirmationOpen = $state(false);
	let listContainer: any;

	const lsVersion = ledgerService.version;
	let xactsWithSpans: Array<{ xact: Xact; span: DirectiveSpan }> = $state([]);

	$effect(() => {
		const _v = $lsVersion;
		ledgerService.getXactsWithSpans().then((result) => {
			xactsWithSpans = result;
			tick().then(() => {
				if (listContainer) listContainer.scrollTop = listContainer.scrollHeight;
			});
		});
	});

	function closeModal() {
		isDeleteAllConfirmationOpen = false;
	}

	async function onDeleteAllClicked() {
		isDeleteAllConfirmationOpen = true;
	}

	async function onDeleteAllConfirmed() {
		closeModal();
		await opfslib.saveFile(CashierFilename, '');
		await ledgerService.invalidate();
		Notifier.success('All local transactions deleted.');
	}

	async function onExportClick() {
		await goto('/export/journal');
	}

	async function onFab() {
		const tx = Xact.create();
		xact.set(tx);
		xactSpan.set(undefined);
		await goto('/tx');
	}

	async function onRowClick(tx: Xact, span: DirectiveSpan) {
		xact.set(tx);
		xactSpan.set(span);
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
		{#if xactsWithSpans.length === 0}
			<p>The device journal is empty</p>
		{:else}
			{#each xactsWithSpans as item (item.span.startLine)}
				<JournalXactRow
					xact={item.xact}
					onclick={() => onRowClick(item.xact, item.span)}
				/>
			{/each}
		{/if}
	</section>

	<Fab onclick={onFab} Icon={PlusIcon} />
</article>

<!-- "Delete All" dialog -->
<input type="checkbox" id="delete-all-journal-confirmation-modal" class="modal-toggle" bind:checked={isDeleteAllConfirmationOpen} />
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Delete</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">Do you want to delete all transactions?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary text-primary-content"
				onclick={onDeleteAllConfirmed}>OK</button
			>
		</footer>
	</div>
</dialog>
