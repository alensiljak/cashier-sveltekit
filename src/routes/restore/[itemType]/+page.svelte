<script lang="ts">
	import { page } from '$app/state';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import appService from '$lib/services/appService';
	import Notifier from '$lib/utils/notifier';
	import { FileButton } from '@skeletonlabs/skeleton';
	import { Modal } from '@skeletonlabs/skeleton-svelte';

	const itemType = page.params.itemType;
	let files: FileList | undefined = $state(undefined);
	let _content: string | undefined = $state(undefined);

	Notifier.init();
	let isRestoreConfirmationOpen = $state(false);

	/**
	 * Close all dialogs.
	 */
	function closeModal() {
		isRestoreConfirmationOpen = false;
	}

	async function onFileChanged(event: Event) {
		let selection = (event.target as HTMLInputElement).files;
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
			Notifier.warn('You need to select a file to restore');
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

<!-- "Restore" dialog -->
<Modal
	bind:open={isRestoreConfirmationOpen}
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
				Do you want to restore the selected file?<br />
				This will overwrite your current Scheduled Transactions.
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
