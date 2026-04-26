<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import OpfsFilePicker from '$lib/components/OpfsFilePicker.svelte';
	import { FilePlusIcon, UploadIcon, Trash2Icon } from '@lucide/svelte';
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import type { FileTreeEntry } from '$lib/utils/opfslib.js';
	import Notifier from '$lib/utils/notifier';

	Notifier.init();

	function preventDefaultDrag(e: DragEvent) {
		e.preventDefault();
	}

	let filePicker = $state<ReturnType<typeof OpfsFilePicker> | null>(null);
	let selectedFile = $state<string | null>(null);
	let showNewFileDialog = $state(false);
	let newFileName = $state('');
	let showDeleteConfirm = $state(false);
	let isDeleting = $state(false);
	let fileToDelete = $state<string | null>(null);
	let isDragOver = $state(false);
	let showDropConflict = $state(false);
	let dropConflictFileName = $state('');
	let dropConflictContent = $state('');
	let fileUploadInput = $state<HTMLInputElement | null>(null);
	let showDeleteAllConfirm = $state(false);
	let isDeletingAll = $state(false);

	onMount(async () => {
		document.addEventListener('dragover', preventDefaultDrag);
		document.addEventListener('drop', preventDefaultDrag);
	});

	onDestroy(() => {
		document.removeEventListener('dragover', preventDefaultDrag);
		document.removeEventListener('drop', preventDefaultDrag);
	});

	function onFileSelect(entry: FileTreeEntry) {
		goto(`/opfs/edit-file?file=${encodeURIComponent(entry.path)}`);
	}

	function confirmDelete(filePath: string) {
		fileToDelete = filePath;
		showDeleteConfirm = true;
	}

	async function deleteFile() {
		if (!fileToDelete) return;

		isDeleting = true;
		try {
			const success = await OpfsLib.deleteFile(fileToDelete);

			if (success) {
				Notifier.success(`File deleted successfully`);
			} else {
				Notifier.error(`Failed to delete file`);
			}

			showDeleteConfirm = false;

			if (selectedFile === fileToDelete) {
				selectedFile = null;
			}

			fileToDelete = null;
			await filePicker?.refresh();
		} catch (error: any) {
			Notifier.error(error.message || 'Failed to delete file');
		} finally {
			isDeleting = false;
		}
	}

	async function createNewFile() {
		if (!newFileName.trim()) {
			Notifier.error('Please enter a filename');
			return;
		}

		try {
			await OpfsLib.saveFile(newFileName.trim(), '');
			Notifier.success(`File "${newFileName}" created successfully`);
			newFileName = '';
			showNewFileDialog = false;
			await filePicker?.refresh();
		} catch (error: any) {
			Notifier.error(error.message || 'Failed to create file');
		}
	}

	function openNewFileDialog() {
		showNewFileDialog = true;
		newFileName = '';
	}

	function closeNewFileDialog() {
		showNewFileDialog = false;
		newFileName = '';
	}

	function onDragOver(event: DragEvent) {
		event.preventDefault();
		isDragOver = true;
	}

	function onDragLeave() {
		isDragOver = false;
	}

	async function onDrop(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;

		const droppedFiles = event.dataTransfer?.files;
		if (!droppedFiles || droppedFiles.length === 0) return;

		const file = droppedFiles[0];
		const content = await file.text();
		const exists = await OpfsLib.fileExists(file.name);

		if (exists) {
			dropConflictFileName = file.name;
			dropConflictContent = content;
			showDropConflict = true;
		} else {
			await OpfsLib.saveFile(file.name, content);
			Notifier.success(`File "${file.name}" saved to OPFS`);
			await filePicker?.refresh();
		}
	}

	async function resolveDropConflict(action: 'overwrite' | 'copy' | 'cancel') {
		if (action === 'cancel') {
			showDropConflict = false;
			return;
		}

		let targetName = dropConflictFileName;
		if (action === 'copy') {
			const dotIndex = dropConflictFileName.lastIndexOf('.');
			if (dotIndex > 0) {
				const name = dropConflictFileName.substring(0, dotIndex);
				const ext = dropConflictFileName.substring(dotIndex);
				targetName = `${name} (1)${ext}`;
			} else {
				targetName = `${dropConflictFileName} (1)`;
			}
		}

		await OpfsLib.saveFile(targetName, dropConflictContent);
		Notifier.success(`File "${targetName}" saved to OPFS`);
		showDropConflict = false;
		await filePicker?.refresh();
	}

	async function onUploadFileSelected(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const content = await file.text();
		const exists = await OpfsLib.fileExists(file.name);

		if (exists) {
			dropConflictFileName = file.name;
			dropConflictContent = content;
			showDropConflict = true;
		} else {
			await OpfsLib.saveFile(file.name, content);
			Notifier.success(`File "${file.name}" saved to OPFS`);
			await filePicker?.refresh();
		}

		input.value = '';
	}

	async function deleteAll() {
		isDeletingAll = true;
		try {
			await OpfsLib.deleteAll();
			selectedFile = null;
			showDeleteAllConfirm = false;
			Notifier.success('All files deleted');
			await filePicker?.refresh();
		} catch (error: any) {
			Notifier.error(error.message || 'Failed to delete all files');
		} finally {
			isDeletingAll = false;
		}
	}
</script>

<article class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="OPFS Files">
		{#snippet menuItems()}
			<li>
				<button class="btn btn-sm btn-ghost gap-2" onclick={openNewFileDialog}>
					<FilePlusIcon class="w-5 h-5" />
					<span>New File</span>
				</button>
			</li>
			<li>
				<button class="btn btn-sm btn-ghost gap-2" onclick={() => fileUploadInput?.click()}>
					<UploadIcon class="w-5 h-5" />
					<span>Upload File</span>
				</button>
			</li>
			<li>
				<button
					class="btn btn-sm btn-ghost gap-2 text-error"
					onclick={() => (showDeleteAllConfirm = true)}
				>
					<Trash2Icon class="w-5 h-5" />
					<span>Delete All</span>
				</button>
			</li>
		{/snippet}
	</Toolbar>

	<input type="file" bind:this={fileUploadInput} class="hidden" onchange={onUploadFileSelected} />

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<section
		class="flex-1 overflow-hidden p-4 transition-all duration-200"
		class:border-2={isDragOver}
		class:border-dashed={isDragOver}
		class:border-primary={isDragOver}
		class:bg-base-200={isDragOver}
		ondragover={onDragOver}
		ondragleave={onDragLeave}
		ondrop={onDrop}
	>
		{#if isDragOver}
			<div class="flex justify-center items-center p-8 text-primary font-semibold">
				Drop file here to save to OPFS
			</div>
		{:else}
			<div class="overflow-x-auto overflow-y-auto h-full">
				<OpfsFilePicker
					bind:this={filePicker}
					bind:selectedFile
					showDeleteButtons
					onfileselect={onFileSelect}
					ondeleteclick={confirmDelete}
				/>
			</div>
		{/if}
	</section>

	<!-- Delete Confirmation Modal -->
	{#if showDeleteConfirm}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">Confirm Deletion</h3>
				<p>Are you sure you want to delete "{fileToDelete}"?</p>
				<div class="modal-action">
					<button class="btn" onclick={() => (showDeleteConfirm = false)} disabled={isDeleting}
						>Cancel</button
					>
					<button class="btn btn-error" onclick={deleteFile} disabled={isDeleting}>
						{isDeleting ? 'Deleting...' : 'Delete'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- New File Dialog Modal -->
	{#if showNewFileDialog}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">Create New Text File</h3>
				<div class="form-control">
					<label for="newFileNameInput" class="label">
						<span class="label-text">Filename</span>
					</label>
					<input
						id="newFileNameInput"
						type="text"
						class="input input-bordered w-full"
						placeholder="Enter filename..."
						bind:value={newFileName}
						onkeydown={(e) => {
							if (e.key === 'Enter') createNewFile();
						}}
					/>
				</div>
				<div class="modal-action">
					<button class="btn" onclick={closeNewFileDialog}>Cancel</button>
					<button class="btn btn-primary" onclick={createNewFile}>Create</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Delete All Confirmation Modal -->
	{#if showDeleteAllConfirm}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">Delete All Files</h3>
				<p>This will permanently delete all files and folders from OPFS. This cannot be undone.</p>
				<div class="modal-action">
					<button
						class="btn"
						onclick={() => (showDeleteAllConfirm = false)}
						disabled={isDeletingAll}>Cancel</button
					>
					<button class="btn btn-error" onclick={deleteAll} disabled={isDeletingAll}>
						{isDeletingAll ? 'Deleting...' : 'Delete All'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Drop Conflict Modal -->
	{#if showDropConflict}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">File Already Exists</h3>
				<p>
					A file named "{dropConflictFileName}" already exists in OPFS. What would you like to do?
				</p>
				<div class="modal-action flex-wrap gap-2">
					<button class="btn" onclick={() => resolveDropConflict('cancel')}>Cancel</button>
					<button class="btn btn-warning" onclick={() => resolveDropConflict('copy')}>
						Create Copy (1)
					</button>
					<button class="btn btn-error" onclick={() => resolveDropConflict('overwrite')}>
						Overwrite
					</button>
				</div>
			</div>
		</div>
	{/if}
</article>
