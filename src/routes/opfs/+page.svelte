<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import OpfsFilePicker from '$lib/components/OpfsFilePicker.svelte';
	import { SaveIcon, FilePlusIcon, UploadIcon } from '@lucide/svelte';
	import { onMount, onDestroy } from 'svelte';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import type { FileTreeEntry } from '$lib/utils/opfslib.js';
	import Notifier from '$lib/utils/notifier';

	Notifier.init();

	function preventDefaultDrag(e: DragEvent) {
		e.preventDefault();
	}

	let filePicker = $state<ReturnType<typeof OpfsFilePicker> | null>(null);
	let selectedFile = $state<string | null>(null);
	let fileContent = $state<string>('');
	let isContentLoading = $state(false);
	let isSaving = $state(false);
	let originalContent = $state<string>('');
	let hasUnsavedChanges = $state(false);
	let showNewFileDialog = $state(false);
	let newFileName = $state('');
	let showDeleteConfirm = $state(false);
	let isDeleting = $state(false);
	let fileToDelete = $state<string | null>(null);
	let isDragOver = $state(false);
	let fileMetadata = $state<OpfsLib.FileMetadata | null>(null);
	let showDropConflict = $state(false);
	let dropConflictFileName = $state('');
	let dropConflictContent = $state('');
	let fileUploadInput = $state<HTMLInputElement | null>(null);

	onMount(async () => {
		document.addEventListener('dragover', preventDefaultDrag);
		document.addEventListener('drop', preventDefaultDrag);
	});

	onDestroy(() => {
		document.removeEventListener('dragover', preventDefaultDrag);
		document.removeEventListener('drop', preventDefaultDrag);
	});

	async function onFileSelect(entry: FileTreeEntry) {
		isContentLoading = true;
		fileContent = '';
		fileMetadata = null;
		try {
			const [content, meta] = await Promise.all([
				OpfsLib.readFile(entry.path),
				OpfsLib.getFileMetadata(entry.path)
			]);
			fileMetadata = meta ?? null;
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
				fileContent = '';
				originalContent = '';
				hasUnsavedChanges = false;
			}

			fileToDelete = null;
			await filePicker?.refresh();
		} catch (error: any) {
			Notifier.error(error.message || 'Failed to delete file');
		} finally {
			isDeleting = false;
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

	function onFileContentChange(event: Event) {
		const target = event.target as HTMLTextAreaElement;
		fileContent = target.value;
		hasUnsavedChanges = fileContent !== originalContent;
	}

	function formatFileSize(bytes?: number): string {
		if (bytes === undefined) return '--';
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}
</script>

<article>
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
		{/snippet}
	</Toolbar>

	<input type="file" bind:this={fileUploadInput} class="hidden" onchange={onUploadFileSelected} />

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<section
		class="p-4 rounded-lg transition-all duration-200"
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
			<div class="mb-4 overflow-x-auto overflow-y-auto" style="height: 400px;">
				<OpfsFilePicker
					bind:this={filePicker}
					bind:selectedFile
					showDeleteButtons
					onfileselect={onFileSelect}
					ondeleteclick={confirmDelete}
				/>
			</div>

			{#if selectedFile}
				<div class="mt-6">
					<div class="flex items-center justify-between mb-2">
						<h3 class="text-lg font-semibold">Content of: {selectedFile}</h3>
						<div class="flex items-center gap-2">
							<button
								class="btn btn-sm btn-primary"
								onclick={saveFile}
								disabled={isSaving || !hasUnsavedChanges}
							>
								<SaveIcon class="w-4 h-4" />
								{isSaving ? 'Saving...' : 'Save'}
							</button>
							{#if hasUnsavedChanges}
								<span class="text-warning text-sm">*Unsaved changes</span>
							{/if}
						</div>
					</div>
					{#if fileMetadata}
						<div class="text-sm text-base-content/60 mb-2 flex gap-4">
							<span>Size: {formatFileSize(fileMetadata.size)}</span>
							<span>Modified: {new Date(fileMetadata.lastModified).toLocaleString()}</span>
							{#if fileMetadata.type}
								<span>Type: {fileMetadata.type}</span>
							{/if}
						</div>
					{/if}
					{#if isContentLoading}
						<div class="flex justify-center items-center p-4">
							<span class="loading loading-spinner loading-md"></span>
						</div>
					{:else}
						<textarea
							class="textarea textarea-bordered w-full font-mono text-sm"
							rows="20"
							oninput={onFileContentChange}>{fileContent}</textarea>
					{/if}
				</div>
			{/if}
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

	<!-- Drop Conflict Modal -->
	{#if showDropConflict}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">File Already Exists</h3>
				<p>A file named "{dropConflictFileName}" already exists in OPFS. What would you like to do?</p>
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
