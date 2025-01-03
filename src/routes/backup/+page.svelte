<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import * as BackupService from '$lib/services/backupService';
	import Notifier from '$lib/utils/notifier';
	import { FileButton, getModalStore, type ModalSettings } from '@skeletonlabs/skeleton';
	import { onMount } from 'svelte';

	const modalStore = getModalStore();

	let _filename: string;
	let files: FileList;

	Notifier.init();

	onMount(() => {
		_filename = BackupService.getBackupFilename();
	});

	async function onBackupClick() {
		await BackupService.createBackup(_filename);
	}

	function onChangeHandler(e: Event): void {
		if (files.length > 1) {
			Notifier.warn('Only one file must be selected!');
			return;
		}

		// prompt for restore
		let file = files[0];
		let filename = file.name;
		// confirm dialog
		const modal: ModalSettings = {
			type: 'confirm',
			// Data
			title: 'Confirm Restore',
			body: 'Do you want to restore' + filename + '?<br/>This will overwrite your existing records.',
			response: async (r: boolean) => {
				if (r) {
					await readFile(file);
				}
			}
		};
		modalStore.trigger(modal);
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
	</section>
</article>
