<script lang="ts">
	/**
	 * Confirmation for destroying this device's copy of a transaction store: records and history.
	 * See `destroyLocalStore()` and doc/backup.md.
	 */
	import { onMount } from 'svelte';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import FileDownIcon from '@lucide/svelte/icons/file-down';
	import { createBackupFile, getBackupFilename } from '#lib/services/backupService';
	import { reloadLedgerFromOpfs } from '#lib/services/ledgerReload';
	import { syncOptions } from '#lib/services/syncOptions.svelte';
	import { getXactStore } from '#lib/storage/xactStoreRegistry';
	import { getScxStore } from '#lib/storage/scxStoreRegistry';
	import { configuredRemoteIds, destroyLocalStore } from '#lib/sync/deltaSyncRegistry';
	import { peerConnection } from '#lib/sync/peerConnection.svelte';
	import { otherTabsOpen } from '#lib/utils/appTabs';
	import Notifier from '#lib/utils/notifier';

	interface Props {
		target: 'xacts' | 'scx';
		onclose: () => void;
	}

	let { target, onclose }: Props = $props();

	const label = $derived(target === 'xacts' ? 'device transactions' : 'scheduled transactions');
	const getStore = () => (target === 'xacts' ? getXactStore() : getScxStore());

	let records = $state<number>();
	/** What is set up to get data back from; undefined until known. */
	let sources = $state<'remote' | 'peer' | 'none'>();
	let otherTabs = $state<boolean | null>(false);
	let choice = $state<'backup' | 'loss'>();
	let busy = $state(false);

	async function checkTabs() {
		otherTabs = await otherTabsOpen();
		return otherTabs;
	}

	onMount(async () => {
		records = (await (await getStore()).list()).length;
		await syncOptions.load();
		if ((await configuredRemoteIds()).length > 0) sources = 'remote';
		else sources = syncOptions.peer ? 'peer' : 'none';
		await checkTabs();
	});

	async function downloadBackup() {
		try {
			await createBackupFile(getBackupFilename(), {
				sections: [target === 'xacts' ? 'workingSet' : 'scx']
			});
		} catch (e) {
			Notifier.error(`Backup failed: ${e instanceof Error ? e.message : e}`);
		}
	}

	async function destroy() {
		busy = true;
		try {
			// Looked at again: a tab may have been opened since the dialog was.
			if (await checkTabs()) return;
			// Live sync would bring the data straight back, or send what happens next.
			if (peerConnection.presence.isInRoom) await peerConnection.disconnect();
			await destroyLocalStore(target, await getStore());
		} catch (e) {
			Notifier.error(`Could not destroy the store: ${e instanceof Error ? e.message : e}`);
			return;
		} finally {
			busy = false;
		}

		Notifier.success(`The local ${label} were destroyed.`);
		onclose();
		if (target === 'xacts') {
			try {
				await reloadLedgerFromOpfs();
			} catch (e) {
				Notifier.error(`The ledger could not be reloaded: ${e instanceof Error ? e.message : e}`);
			}
		}
	}
</script>

<div class="modal modal-open" role="alertdialog" aria-labelledby="destroy-store-title">
	<div class="modal-box border-error space-y-3 border-2">
		<h3 id="destroy-store-title" class="text-error flex items-center gap-2 text-lg font-bold">
			<TriangleAlert size={22} />
			Destroy the local {label}?
		</h3>

		<p>
			This deletes {records === undefined ? 'all' : records} record(s)
			<strong>and the history</strong>
			of this store on this device. It cannot be undone.
		</p>

		<ul class="list-disc space-y-1 pl-5 text-sm">
			<li>
				Nothing is deleted on other devices or in remote storage. This is not a reset. Live Peer
				Sync is disconnected.
			</li>
			<li>
				<strong>Only data in a backup or another copy can be recovered.</strong> What was never synced
				exists nowhere else, unless a backup has it.
			</li>
			{#if sources === 'remote'}
				<li>
					The next S3 or WebDAV sync downloads what the storage still holds, including this device's
					own uploads. This cannot be guaranteed to be everything.
				</li>
			{:else if sources === 'peer'}
				<li>
					Only Peer Sync is set up: another device can send back just what it has, and it must be
					online.
				</li>
			{/if}
			<li>
				Restoring a backup and then syncing also sends whatever in the backup was never synced to
				your other devices.
			</li>
			{#if target === 'scx'}
				<li class="text-error">
					Restoring scheduled transactions from a backup and then syncing can bring back deleted
					entries or replace newer edits, also on other devices. If sync has your current data,
					don't restore them.
				</li>
			{/if}
		</ul>

		{#if sources === 'none'}
			<div class="alert alert-error text-sm">
				<TriangleAlert size={18} />
				<span>No sync is set up. Without a backup, this data will be permanently lost.</span>
			</div>
		{/if}

		<div>
			<button type="button" class="btn btn-sm" onclick={downloadBackup} disabled={busy}>
				<FileDownIcon size={16} /> Download backup
			</button>
			<p class="mt-1 text-xs opacity-60">Check that the file was saved before you continue.</p>
		</div>

		<fieldset class="space-y-2 text-sm">
			<label class="flex cursor-pointer items-start gap-2">
				<input type="radio" class="radio radio-sm" value="backup" bind:group={choice} />
				<span>I have checked that I have a usable backup</span>
			</label>
			<label class="flex cursor-pointer items-start gap-2">
				<input type="radio" class="radio radio-error radio-sm" value="loss" bind:group={choice} />
				<span>I accept permanent loss</span>
			</label>
		</fieldset>

		{#if otherTabs}
			<div class="alert alert-warning text-sm">
				<span>
					Cashier is open in another tab or window, which could write the old data back. Close it,
					then check again.
				</span>
				<button type="button" class="btn btn-xs" onclick={checkTabs}>Check again</button>
			</div>
		{:else if otherTabs === null}
			<p class="text-warning text-sm">
				Close every other Cashier tab or window first: they could write the old data back.
			</p>
		{/if}

		<div class="modal-action">
			<button type="button" class="btn" onclick={onclose} disabled={busy}>Cancel</button>
			<button
				type="button"
				class="btn btn-error"
				onclick={destroy}
				disabled={busy || !choice || !!otherTabs || sources === undefined}
			>
				<TriangleAlert size={16} />
				{busy ? 'Destroying...' : 'Destroy'}
			</button>
		</div>
	</div>
</div>
