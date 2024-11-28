<script lang="ts">
	import { page } from '$app/stores';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import appService from '$lib/services/appService';
	import Notifier from '$lib/utils/notifier';
	import { FileButton, getModalStore, type ModalSettings } from '@skeletonlabs/skeleton';

	const modalStore = getModalStore();
	const itemType = $page.params.itemType;
	let files: FileList | undefined = $state(undefined);
	let _content: string | undefined = $state(undefined);

	Notifier.init()

	async function onFileChanged(event: Event) {
		let selection = (event.target as HTMLInputElement).files;
		if (!selection || selection.length === 0) {
			console.error('nothing selected');
			return;
		}

		let file = selection[0];
		console.debug('file:', file);

		_content = await file.text();
	}

	async function onRestoreClicked() {
		if (!_content) {
			Notifier.warn('You need to select a file to restore');
			return;
		}

		// confirmation
		const modal: ModalSettings = {
			type: 'confirm',
			title: 'Confirm Restore',
			body: 'Do you want to restore the selected file?\nThis will overwrite your current Scheduled Transactions.',
			response: async (r: boolean) => {
				if (r) {
					await appService.importScheduledTransactions(_content as string);

					Notifier.success('Restore complete!');
				}
			}
		};
		modalStore.trigger(modal);
	}
</script>

<main class="grid h-full h-screen grid-rows-[auto_auto_1fr_auto]">
	<Toolbar title={`Restore ${itemType}`} />

	<div class="p-1">
		<p>You can currently restore the backup of Scheduled Transactions</p>
		<p>Note that this will overwrite all your current records of the same type!</p>

		<center class="py-6">
			<FileButton name="files" bind:files button="btn bg-primary-500" on:change={onFileChanged} />
		</center>
	</div>

	<div class="px-1">
		<textarea class="textarea h-full" bind:value={_content}> </textarea>
	</div>

	<center class="py-6">
		<button
			type="button"
			class="btn bg-warning-500 uppercase text-error-500"
			onclick={onRestoreClicked}>Restore</button
		>
	</center>
</main>
