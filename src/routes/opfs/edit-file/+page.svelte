<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SaveIcon, XIcon } from '@lucide/svelte';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import Notifier from '$lib/utils/notifier';

	Notifier.init();

	const filePath = $derived(page.url.searchParams.get('file') ?? '');

	let fileContent = $state('');
	let originalContent = $state('');
	let hasUnsavedChanges = $state(false);
	let isLoading = $state(true);
	let isSaving = $state(false);

	onMount(async () => {
		if (!filePath) {
			goto('/opfs');
			return;
		}

		try {
			const content = await OpfsLib.readFile(filePath);
			fileContent = content ?? '';
			originalContent = fileContent;
		} catch (error: any) {
			Notifier.error(error.message || 'Failed to read file');
		} finally {
			isLoading = false;
		}
	});

	async function saveFile() {
		if (!hasUnsavedChanges) return;

		isSaving = true;
		try {
			await OpfsLib.saveFile(filePath, fileContent);
			originalContent = fileContent;
			hasUnsavedChanges = false;
			Notifier.success('File saved successfully');
		} catch (error: any) {
			Notifier.error(error.message || 'Failed to save file');
		} finally {
			isSaving = false;
		}
	}

	function close() {
		goto('/opfs');
	}

	function onContentChange(event: Event) {
		const target = event.target as HTMLTextAreaElement;
		fileContent = target.value;
		hasUnsavedChanges = fileContent !== originalContent;
	}
</script>

<article class="h-screen flex flex-col overflow-hidden">
	<Toolbar title={filePath || 'Edit File'} />

	<div class="flex items-center gap-2 px-4 py-2 border-b border-base-300">
		<button
			class="btn btn-primary btn-sm gap-2"
			onclick={saveFile}
			disabled={isSaving || !hasUnsavedChanges}
		>
			<SaveIcon class="w-4 h-4" />
			{isSaving ? 'Saving...' : 'Save'}
		</button>
		{#if hasUnsavedChanges}
			<span class="text-warning text-sm">*Unsaved changes</span>
		{/if}
		<div class="flex-1"></div>
		<button class="btn btn-ghost btn-sm gap-2" onclick={close}>
			<XIcon class="w-4 h-4" />
			Close
		</button>
	</div>

	{#if isLoading}
		<div class="flex-1 flex justify-center items-center">
			<span class="loading loading-spinner loading-md"></span>
		</div>
	{:else}
		<textarea
			class="flex-1 textarea font-mono text-sm resize-none rounded-none border-0 focus:outline-none w-full"
			oninput={onContentChange}
		>{fileContent}</textarea>
	{/if}
</article>
