<script lang="ts">
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import Fab from '$lib/components/FAB.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { Xact } from '$lib/data/model';
	import db from '$lib/data/db';
	import { getDeviceId } from '$lib/sync/ydocDevices';
	import { xact, xactId } from '$lib/data/mainStore';
	import type { StoredXact, XactId } from '$lib/storage/xactStore';
	import { getXactStore, subscribeXactStore } from '$lib/storage/xactStoreRegistry';
	import Notifier from '$lib/utils/notifier';
	import { FileDownIcon, ImportIcon, PlusIcon, TrashIcon } from '@lucide/svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import { reloadLedgerFromOpfs } from '$lib/services/ledgerReload';

	Notifier.init();

	let isDeleteAllConfirmationOpen = $state(false);
	let listContainer = $state<HTMLElement | null>(null);

	let storedXacts: StoredXact[] = $state([]);
	let ownDeviceId = $state('');
	let peerNames = $state<Record<string, string>>({});

	/** Name of the device that created a record, or null for records made here (or without an origin). */
	function foreignOrigin(origin?: string): string | null {
		if (!origin || origin === ownDeviceId) return null;
		return peerNames[origin] ?? `Device ${origin.slice(0, 6)}`;
	}

	async function loadXacts() {
		const result = await (await getXactStore()).list();
		if (result.some((r) => r.origin)) {
			ownDeviceId = await getDeviceId();
			peerNames = Object.fromEntries((await db.peers.toArray()).map((p) => [p.id, p.name]));
		}
		storedXacts = result;
		// A single tick() can fire before the browser has reflowed newly-mounted rows
		// (e.g. wrapped account names), leaving scrollHeight stale and the last xact's
		// postings cut off — wait an extra frame for layout to actually settle.
		tick().then(() => {
			requestAnimationFrame(() => {
				if (listContainer) listContainer.scrollTop = listContainer.scrollHeight;
			});
		});
	}

	$effect(() => {
		void loadXacts();
		return subscribeXactStore(() => void loadXacts());
	});

	function closeModal() {
		isDeleteAllConfirmationOpen = false;
	}

	async function onDeleteAllClicked() {
		isDeleteAllConfirmationOpen = true;
	}

	async function onDeleteAllConfirmed() {
		closeModal();
		await (await getXactStore()).clear();
		// Re-parse the full book in the background — keeps the fullLedgerService
		// cache and the "modified" change indicator in sync (same pattern as
		// every other cashier.bean mutation; see doc/architecture.md).
		void reloadLedgerFromOpfs();
		Notifier.success('All local transactions deleted.');
	}

	async function onExportClick() {
		await goto('/export/journal');
	}

	async function onFab() {
		const tx = Xact.create();
		xact.set(tx);
		xactId.set(undefined);
		await goto('/tx');
	}

	async function onRowClick(tx: Xact, id: XactId) {
		xact.set(tx);
		xactId.set(id);
		goto('/xact-actions');
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Device Journal">
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
			<HelpButton topic="journal" variant="menu-item" />
		{/snippet}
	</Toolbar>

	<section
		class="grow overflow-y-auto touch-pan-y space-y-2 p-1 pb-3 mx-auto max-w-2xl w-full"
		bind:this={listContainer}
	>
		{#if storedXacts.length === 0}
			<p>The device journal is empty</p>
		{:else}
			{#each storedXacts as item (item.id)}
				{@const from = foreignOrigin(item.origin)}
				<JournalXactRow
					xact={item.xact}
					badge={from}
					badgeTitle="Created on another device"
					onclick={() => onRowClick(item.xact, item.id)}
				/>
			{/each}
		{/if}
	</section>

	<Fab onclick={onFab} Icon={PlusIcon} />
</main>

<!-- "Delete All" dialog -->
<input
	type="checkbox"
	id="delete-all-journal-confirmation-modal"
	class="modal-toggle"
	bind:checked={isDeleteAllConfirmationOpen}
/>
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
