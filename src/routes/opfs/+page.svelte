<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { RefreshCcwIcon, SaveIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import Notifier from '$lib/utils/notifier';

	Notifier.init();

	let files = $state<string[]>([]);
	let isLoading = $state(false);
	let selectedFile = $state<string | null>(null);
	let fileContent = $state<string>('');
	let isContentLoading = $state(false);
	let isSaving = $state(false);
	let originalContent = $state<string>('');
	let hasUnsavedChanges = $state(false);

	onMount(async () => {
		await loadFiles();
	});

	async function loadFiles() {
		isLoading = true;
		try {
			const fileList = await OpfsLib.listFiles();
			files = fileList.sort();
		} catch (error: any) {
			console.error('Error loading files:', error);
			Notifier.error(error.message || 'Failed to load files');
		} finally {
			isLoading = false;
		}
	}

	async function onFileClick(filename: string) {
		selectedFile = filename;
		isContentLoading = true;
		fileContent = '';
		try {
			const content = await OpfsLib.readFile(filename);
			if (content !== undefined) {
				fileContent = content;
				originalContent = content;
				hasUnsavedChanges = false;
			} else {
				fileContent = 'File is empty or could not be read.';
				originalContent = '';
				hasUnsavedChanges = false;
			}
		} catch (error: any) {
			Notifier.error(error.message || 'Failed to read file');
			fileContent = `Error: ${error.message || 'Failed to read file'}`;
			originalContent = '';
			hasUnsavedChanges = false;
		} finally {
			isContentLoading = false;
		}
	}

	async function saveFile() {
		if (!selectedFile || !hasUnsavedChanges) return;
		
		isSaving = true;
		try {
			await OpfsLib.saveFile(selectedFile, fileContent);
			originalContent = fileContent;
			hasUnsavedChanges = false;
			Notifier.success('File saved successfully');
		} catch (error: any) {
			Notifier.error(error.message || 'Failed to save file');
		} finally {
			isSaving = false;
		}
	}

	function onFileContentChange(event: Event) {
		const target = event.target as HTMLTextAreaElement;
		fileContent = target.value;
		if (fileContent !== originalContent) {
			hasUnsavedChanges = true;
		} else {
			hasUnsavedChanges = false;
		}
	}
</script>

<article>
	<Toolbar title="OPFS Files">
		{#snippet menuItems()}
			<li>
				<button class="btn btn-sm btn-circle btn-ghost" onclick={loadFiles} disabled={isLoading}>
					<RefreshCcwIcon class="w-5 h-5 {isLoading ? 'animate-spin' : ''}" />
				</button>
			</li>
		{/snippet}
	</Toolbar>

	<section class="p-4">
		{#if isLoading}
			<div class="flex justify-center items-center p-8">
				<span class="loading loading-spinner loading-lg"></span>
			</div>
		{:else if files.length === 0}
			<div class="alert alert-info">
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
				</svg>
				<span>No files found in OPFS storage.</span>
			</div>
		{:else}
			<div class="mb-4 overflow-x-auto">
				<table class="table table-zebra">
					<thead>
						<tr>
							<th>Filename</th>
							<th>Size</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each files as filename}
							<tr class:bg-secondary={selectedFile === filename}>
								<td class="font-mono text-sm">{filename}</td>
								<td>—</td>
								<td>
									<button class="btn btn-sm btn-primary" onclick={() => onFileClick(filename)}>View</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if selectedFile}
				<div class="mt-6">
					<div class="flex items-center justify-between mb-2">
						<h3 class="text-lg font-semibold">Content of: {selectedFile}</h3>
						<div class="flex items-center gap-2">
							<button class="btn btn-sm btn-primary" onclick={saveFile} disabled={isSaving || !hasUnsavedChanges}>
								<SaveIcon class="w-4 h-4" />
								{isSaving ? 'Saving...' : 'Save'}
							</button>
							{#if hasUnsavedChanges}
								<span class="text-warning text-sm">*Unsaved changes</span>
							{/if}
						</div>
					</div>
					{#if isContentLoading}
						<div class="flex justify-center items-center p-4">
							<span class="loading loading-spinner loading-md"></span>
						</div>
					{:else}
						<textarea class="textarea textarea-bordered w-full font-mono text-sm" rows="20"
							oninput={onFileContentChange}>{fileContent}</textarea>
					{/if}
				</div>
			{/if}
		{/if}
	</section>
</article>
