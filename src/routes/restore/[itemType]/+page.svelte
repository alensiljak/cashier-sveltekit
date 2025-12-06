<script lang="ts">
	import { page } from '$app/state';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import appService from '$lib/services/appService';
	import Notifier from '$lib/utils/notifier';
	import type { FileChangeDetails } from '@zag-js/file-upload';

	const itemType = page.params.itemType;
	let _content = $state<string>();

	Notifier.init();

	let isRestoreConfirmationOpen = $state(false);

	/**
	 * Close all dialogs.
	 */
	function closeModal() {
		isRestoreConfirmationOpen = false;
	}

	async function onFileChanged(details: FileChangeDetails) {
		let selection = details.acceptedFiles;
		if (!selection || selection.length === 0) {
			console.error('nothing selected');
			return;
		}

		let file = selection[0];
		// console.debug('file:', file);

		_content = await file.text();
	}

	async function onRestoreClicked() {
		if (!_content) {
			Notifier.info('You need to select a file to restore');
			return;
		}

		// confirmation
		isRestoreConfirmationOpen = true;
	}

	async function onRestoreConfirmed() {
		closeModal();

		await appService.importScheduledTransactions(_content as string);

		Notifier.success('Restore complete!');
	}
</script>

<main class="grid h-full h-screen grid-rows-[auto_auto_1fr_auto]">
	<Toolbar title={`Restore ${itemType}`} />

	<div class="p-1">
		<p>You can currently restore the Scheduled Transactions.</p>
		<p>This will overwrite all your existing records of the same type!</p>
		<p>Either select a backup file or paste the backup into the text box below.</p>

		<center class="py-6">
			<label class="btn bg-primary-500">
				<input type="file" name="files" accept=".json" onchange={(e) => {
					const target = e.target as HTMLInputElement;
					onFileChanged({ acceptedFiles: Array.from(target.files || []) });
				}} />
				<span>Select the backup file</span>
			</label>
		</center>
	</div>

	<div class="px-1">
		<textarea class="textarea h-full" bind:value={_content}> </textarea>
	</div>

	<center class="py-6">
		<button
			type="button"
			class="btn bg-warning-500 text-error-500 uppercase"
			onclick={onRestoreClicked}>Restore</button
		>
	</center>
</main>

<!-- "Restore" dialog -->
<input type="checkbox" id="restore-item-confirmation-modal" class="modal-toggle" bind:checked={isRestoreConfirmationOpen} />
<div class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Restore</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">
				Do you want to restore the selected file?<br />
				This will overwrite your current Scheduled Transactions.
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary text-tertiary-500"
				onclick={onRestoreConfirmed}>OK</button
			>
		</footer>
	</div>
</div>
