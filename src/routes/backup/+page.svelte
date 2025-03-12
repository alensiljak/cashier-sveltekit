<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import * as BackupService from '$lib/services/backupService';
	import Notifier from '$lib/utils/notifier';
	import { FileButton } from '@skeletonlabs/skeleton';
	import { onMount } from 'svelte';
	import { Modal } from '@skeletonlabs/skeleton-svelte';

	let isRestoreConfirmationOpen = $state(false);

	let _filename = $state<string>();
	let files = $state<FileList>();

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
		await BackupService.createBackup(_filename as string);
	}

	function onChangeHandler(e: Event): void {
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
		<h3 class="h3">Create Backup</h3>

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
			<button type="button" class="variant-filled-primary btn" onclick={onBackupClick}
				>Backup</button
			>
		</center>
	</section>
	<hr class="my-8" />
	<section class="p-1">
		<h3 class="h3">Restore Backup</h3>
		<div class="flex flex-row items-center space-x-4">
			<p>To restore (overwriting any existing records!):</p>
			<FileButton
				name="files"
				button="btn variant-soft-secondary"
				bind:files
				on:change={onChangeHandler}
			/>
		</div>
		<div>
			It is recommended to also perform a Cashier Sync after restoring a backup.
		</div>
	</section>
</article>

<!-- "Restore" dialog -->
<Modal
	open={isRestoreConfirmationOpen}
	triggerBase="hidden"
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-screen-sm"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet trigger()}Open Modal{/snippet}
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h4">Confirm Restore</h2>
		</header>
		<article>
			<p class="opacity-60">
				Do you want to restore {files?.[0].name}?<br />
				This will overwrite your existing records.
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="variant-tonal btn" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn-primary variant-filled-primary btn text-tertiary-500"
				onclick={onRestoreConfirmed}>OK</button
			>
		</footer>
	{/snippet}
</Modal>
