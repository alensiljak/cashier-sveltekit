<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import * as BackupService from '$lib/services/backupService';
	import Notifier from '$lib/utils/notifier';
	import { FileDownIcon, Share2Icon } from '@lucide/svelte';
	import { onMount } from 'svelte';
	// import type { FileChangeDetails } from '@zag-js/file-upload';

	type FileChangeDetails = {
		acceptedFiles: File[];
	};

	let isRestoreConfirmationOpen = $state(false);

	let _filename = $state<string>();
	let files = $state<File[]>();

	Notifier.init();

	onMount(() => {
		_filename = BackupService.getBackupFilename();
	});

	/**
	 * Close all dialogs.
	 */
	function closeModal() {
		isRestoreConfirmationOpen = false;
	}

	async function onBackupClick() {
		await BackupService.createBackupFile(_filename as string);
	}

	function onChangeHandler(details: FileChangeDetails): void {
		files = details.acceptedFiles;
		if (!files) return;

		if (files.length > 1) {
			Notifier.info('Only one file must be selected!');
			return;
		}

		// prompt for restore
		isRestoreConfirmationOpen = true;
	}

	async function onRestoreConfirmed() {
		closeModal();

		if (!files) return;

		await readFile(files[0]);
	}

	async function onShareClick() {
		const output = await BackupService.createBackup();

		if (navigator.share) {
			await navigator.share({
				title: 'Cashier Backup',
				text: output
			});
		} else {
			Notifier.error('Web Share API not supported.');
		}
	}

	async function readFile(file: File) {
		let fileContent;

		const reader = new FileReader();
		reader.onload = async (e: any) => {
			fileContent = e?.target?.result; // Store the file content
			await BackupService.restoreBackup(fileContent);
			Notifier.success('Backup restored');
		};
		reader.readAsText(file); // Read as text
	}
</script>

<article>
	<Toolbar title="Backup"></Toolbar>
	<section class="p-1">
		<h3 class="text-3xl font-semibold">Create Backup</h3>

		<p>You can backup all local data:</p>
		<ul class="list mx-8">
			<li>transactions</li>
			<li>scheduled transactions</li>
			<li>settings</li>
		</ul>
		<p>into</p>

		<div class="flex flex-row">
			<input type="text" class="input" bind:value={_filename} readonly />
		</div>

		<center class="pt-4">
			<button type="button" class="btn btn-primary rounded" onclick={onBackupClick}>
				<FileDownIcon />
				<span>Backup</span>
			</button>
			<button type="button" class="btn btn-primary rounded" onclick={onShareClick}>
				<Share2Icon />
				<span>Share</span>
			</button>
		</center>
	</section>
	<hr class="my-8" />
	<section class="p-1">
		<h3 class="text-3xl font-semibold">Restore Backup</h3>
		<div class="flex flex-row items-center space-x-4">
			<p>To restore (overwriting any existing records!):</p>
			<input
				type="file"
				name="files"
				accept=".json"
				class="file-input file-input-secondary rounded"
				onchange={(e) => {
					const target = e.target as HTMLInputElement;
					onChangeHandler({ acceptedFiles: Array.from(target.files || []) });
				}}
			/>
			<label class="label">
				<span>Click to choose the backup file</span>
			</label>
		</div>
		<div>
			<p>After restoring a backup, you should</p>
			<ul>
				<li>
					load the Asset Allocation definition file (it is then stored in OPFS, which is not backed
					up)
				</li>
				<li>perform a Cashier Sync to populate the latest financial data</li>
			</ul>
		</div>
	</section>
</article>

<!-- "Restore" dialog -->
<input
	type="checkbox"
	id="restore-confirmation-modal"
	class="modal-toggle"
	bind:checked={isRestoreConfirmationOpen}
/>
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Restore</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">
				Do you want to restore {files?.[0].name}?<br />
				This will overwrite your existing records.
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary text-primary-content"
				onclick={onRestoreConfirmed}>OK</button
			>
		</footer>
	</div>
</dialog>
