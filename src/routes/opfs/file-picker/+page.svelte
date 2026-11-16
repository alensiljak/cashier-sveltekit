<script lang="ts">
	import OpfsFilePicker from '#lib/components/OpfsFilePicker.svelte';
	import FAB from '#lib/components/FAB.svelte';
	import Check from '@lucide/svelte/icons/check';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { createDirectory } from '#lib/utils/opfslib';

	let selectedFile = $state<string | null>(null);
	let checkedFiles = $state<string[]>([]);
	let showCheckboxes = $state(false);

	/** New-file mode: the path of a file that does not exist yet. */
	let newPath = $state('');
	/** Last folder tapped in the tree; new files are created inside it. */
	let folder = $state('');

	const returnSetting = $derived(page.url.searchParams.get('returnSetting'));
	/** Page to hand the selection back to (defaults to Settings). Internal paths only. */
	const returnTo = $derived.by(() => {
		const target = page.url.searchParams.get('returnTo');
		return target && target.startsWith('/') && !target.startsWith('//') ? target : '/settings';
	});
	/** `allowNew=1` lets the user type a path for a file that does not exist yet. */
	const allowNew = $derived(page.url.searchParams.get('allowNew') === '1');
	/** Appended to a new file name that lacks it, e.g. `.bean`. */
	const extension = $derived(page.url.searchParams.get('ext') ?? '');

	function basename(path: string): string {
		return path.slice(path.lastIndexOf('/') + 1);
	}

	function onDirectoryClick(entry: { path: string }) {
		folder = entry.path;
		// Re-home whatever name was typed into the tapped folder.
		const name = basename(newPath.trim());
		newPath = name ? `${folder}/${name}` : '';
	}

	let picker = $state<ReturnType<typeof OpfsFilePicker> | null>(null);
	let newFolder = $state('');
	let folderError = $state<string | null>(null);

	/** Create `newFolder` inside the current folder (or at the root) and move into it. */
	async function createFolder() {
		const name = newFolder.trim().replace(/^\/+|\/+$/g, '');
		if (!name) return;
		const path = folder ? `${folder}/${name}` : name;
		try {
			await createDirectory(path);
		} catch (e) {
			folderError = e instanceof Error ? e.message : String(e);
			return;
		}
		folderError = null;
		newFolder = '';
		await picker?.refresh();
		picker?.expandTo(path);
		onDirectoryClick({ path });
	}

	function onFileSelect() {
		// Picking an existing file replaces any typed new-file path.
		newPath = '';
	}

	function onNewPathInput() {
		// Typing a name clears the existing-file selection.
		if (newPath.trim() !== '') selectedFile = null;
	}

	/** The typed path with the folder prefix and extension applied. */
	function resolvedNewPath(): string {
		let path = newPath.trim().replace(/^\/+/, '');
		if (path === '') return '';
		if (!path.includes('/') && folder) path = `${folder}/${path}`;
		if (extension && !path.endsWith(extension)) path += extension;
		return path;
	}

	const chosen = $derived(allowNew && newPath.trim() !== '' ? resolvedNewPath() : selectedFile);

	function onFabClick() {
		if (returnSetting) {
			if (chosen) {
				goto(
					`${returnTo}?settingKey=${encodeURIComponent(returnSetting)}&settingValue=${encodeURIComponent(chosen)}`
				);
			}
			return;
		}
		showCheckboxes = !showCheckboxes;
		if (!showCheckboxes) {
			checkedFiles = [];
		}
	}
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<div class="flex-1 overflow-y-auto touch-pan-y p-4">
		{#if returnSetting}
			<p class="mb-3 text-sm opacity-70">
				Select a file for <strong>{returnSetting}</strong>, then tap the confirm button.
			</p>
		{/if}
		{#if returnSetting && allowNew}
			<div class="mb-3 space-y-1">
				<label class="text-sm font-medium" for="new-file-path">Or a new file</label>
				<input
					id="new-file-path"
					type="text"
					class="input input-bordered input-sm w-full font-mono"
					placeholder={folder ? `${folder}/name${extension}` : `folder/name${extension}`}
					bind:value={newPath}
					oninput={onNewPathInput}
				/>
				<p class="text-xs opacity-60">
					{folder ? `Folder: ${folder}. ` : ''}Tap a folder below to place the file in it; folders
					are created as needed.
				</p>
				{#if chosen && newPath.trim() !== ''}
					<p class="text-xs opacity-60">Will use: <code>{chosen}</code></p>
				{/if}

				<div class="flex items-center gap-2 pt-2">
					<input
						type="text"
						class="input input-bordered input-sm min-w-0 flex-1 font-mono"
						aria-label="New folder name"
						placeholder={folder ? `New folder in ${folder}` : 'New folder'}
						bind:value={newFolder}
						onkeydown={(e) => e.key === 'Enter' && void createFolder()}
					/>
					<button
						type="button"
						class="btn btn-secondary btn-sm"
						disabled={newFolder.trim() === ''}
						onclick={() => void createFolder()}
					>
						Create folder
					</button>
				</div>
				{#if folderError}
					<p class="text-xs text-error">{folderError}</p>
				{/if}
			</div>
		{/if}
		<OpfsFilePicker
			bind:this={picker}
			bind:selectedFile
			bind:checkedFiles
			{showCheckboxes}
			onfileselect={onFileSelect}
			ondirectoryclick={onDirectoryClick}
		/>
	</div>
</main>

<FAB
	Icon={Check}
	onclick={onFabClick}
	backgroundColor={showCheckboxes ? 'btn-primary' : 'btn-accent'}
/>
