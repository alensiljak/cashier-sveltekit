<!-- 
* Synchronization of the OPFS ledger storage with a directory on the
* current device. This requires File System API access, provided by
* Chromium-based browsers.
-->
<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import {
		RefreshCcwIcon,
		FolderOpenIcon,
		FileIcon,
		FolderIcon
	} from '@lucide/svelte';
	import Notifier from '$lib/utils/notifier';

	Notifier.init();

	interface EntryInfo {
		name: string;
		kind: 'file' | 'directory';
		size?: number;
		lastModified?: number;
	}

	let dirHandle = $state<FileSystemDirectoryHandle | null>(null);
	let dirName = $state('');
	let entries = $state<EntryInfo[]>([]);
	let isLoading = $state(false);
	let selectedEntry = $state<EntryInfo | null>(null);
	let preview = $state('');
	let isPreviewLoading = $state(false);
	let fileMeta = $state<Record<string, string>>({});

	async function pickDirectory() {
		try {
			dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
			dirName = dirHandle!.name;
			await loadEntries();
		} catch (error: any) {
			if (error.name !== 'AbortError') {
				console.error('Error picking directory:', error);
				Notifier.error(error.message || 'Failed to open directory');
			}
		}
	}

	async function loadEntries() {
		if (!dirHandle) return;

		isLoading = true;
		selectedEntry = null;
		preview = '';
		fileMeta = {};

		try {
			const list: EntryInfo[] = [];

			for await (const [name, handle] of (dirHandle as any).entries()) {
				const info: EntryInfo = { name, kind: handle.kind };

				if (handle.kind === 'file') {
					try {
						const file = await (handle as FileSystemFileHandle).getFile();
						info.size = file.size;
						info.lastModified = file.lastModified;
					} catch {
						// metadata unavailable
					}
				}

				list.push(info);
			}

			// Sort: directories first, then files, alphabetically
			entries = list.sort((a, b) => {
				if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
				return a.name.localeCompare(b.name);
			});
		} catch (error: any) {
			console.error('Error loading entries:', error);
			Notifier.error(error.message || 'Failed to read directory');
		} finally {
			isLoading = false;
		}
	}

	function formatSize(bytes?: number): string {
		if (bytes === undefined) return '--';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function formatDate(ms?: number): string {
		if (!ms) return '--';
		return new Date(ms).toLocaleString();
	}

	function isTextFile(name: string): boolean {
		const textExtensions = [
            '.beancount', '.bean', '.ledger', '.journal',
			'.txt', '.md', '.csv', '.json', '.xml', '.html', '.css', '.js', '.ts',
			'.svelte', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.log',
			'.sh', '.bat', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h',
			'.ledger', '.journal', '.dat', '.env', '.gitignore', '.editorconfig'
		];
		const lower = name.toLowerCase();
		return textExtensions.some((ext) => lower.endsWith(ext)) || !lower.includes('.');
	}

	async function onEntryClick(entry: EntryInfo) {
		if (entry.kind === 'directory') return;
		if (!dirHandle) return;

		selectedEntry = entry;
		isPreviewLoading = true;
		preview = '';
		fileMeta = {};

		try {
			const fileHandle = await dirHandle.getFileHandle(entry.name);
			const file = await fileHandle.getFile();

			// Collect metadata
			const meta: Record<string, string> = {};
			meta['Name'] = file.name;
			meta['Size'] = formatSize(file.size);
			meta['Type'] = file.type || '(unknown)';
			meta['Last Modified'] = formatDate(file.lastModified);
			fileMeta = meta;

			// Preview text content
			if (isTextFile(file.name)) {
				const text = await file.text();
				const lines = text.split('\n');
				const first20 = lines.slice(0, 20).join('\n');
				preview = first20;
				if (lines.length > 20) {
					preview += `\n... (${lines.length - 20} more lines)`;
				}
			} else {
				preview = '(binary file -- no text preview)';
			}
		} catch (error: any) {
			console.error('Error reading file:', error);
			Notifier.error(error.message || 'Failed to read file');
			preview = `Error: ${error.message || 'Failed to read file'}`;
		} finally {
			isPreviewLoading = false;
		}
	}
</script>

<article>
	<Toolbar title="File System">
		{#snippet menuItems()}
			<li>
				<button class="btn btn-sm btn-ghost gap-2" onclick={pickDirectory}>
					<FolderOpenIcon class="w-5 h-5" />
					<span>Open Directory</span>
				</button>
			</li>
			{#if dirHandle}
				<li>
					<button
						class="btn btn-sm btn-ghost gap-2"
						onclick={loadEntries}
						disabled={isLoading}
					>
						<RefreshCcwIcon class="w-5 h-5 {isLoading ? 'animate-spin' : ''}" />
						<span>Refresh</span>
					</button>
				</li>
			{/if}
		{/snippet}
	</Toolbar>

	<section class="p-4">
		{#if !dirHandle}
			<div class="flex flex-col items-center justify-center gap-4 p-12">
				<FolderOpenIcon class="w-16 h-16 opacity-30" />
				<p class="text-lg opacity-60">Select a directory to browse its contents.</p>
				<button class="btn btn-primary gap-2" onclick={pickDirectory}>
					<FolderOpenIcon class="w-5 h-5" />
					Open Directory
				</button>
			</div>
		{:else if isLoading}
			<div class="flex justify-center items-center p-8">
				<span class="loading loading-spinner loading-lg"></span>
			</div>
		{:else if entries.length === 0}
			<div class="alert alert-info">
				<span>Directory "{dirName}" is empty.</span>
			</div>
		{:else}
			<p class="text-sm opacity-60 mb-2">
				Browsing: <span class="font-mono font-semibold">{dirName}/</span>
				({entries.length} entries)
			</p>

			<div class="mb-4 overflow-x-auto">
				<table class="table table-zebra table-sm">
					<thead>
						<tr>
							<th></th>
							<th>Name</th>
							<th>Size</th>
							<th>Last Modified</th>
						</tr>
					</thead>
					<tbody>
						{#each entries as entry}
							<tr
								class="cursor-pointer hover"
								class:bg-secondary={selectedEntry?.name === entry.name}
								onclick={() => onEntryClick(entry)}
							>
								<td class="w-8">
									{#if entry.kind === 'directory'}
										<FolderIcon class="w-4 h-4 opacity-60" />
									{:else}
										<FileIcon class="w-4 h-4 opacity-60" />
									{/if}
								</td>
								<td class="font-mono text-sm">{entry.name}</td>
								<td class="text-sm">{entry.kind === 'file' ? formatSize(entry.size) : '--'}</td>
								<td class="text-sm">{formatDate(entry.lastModified)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if selectedEntry}
				<div class="mt-6">
					<!-- File metadata -->
					<h3 class="text-lg font-semibold mb-2">{selectedEntry.name}</h3>

					{#if isPreviewLoading}
						<div class="flex justify-center items-center p-4">
							<span class="loading loading-spinner loading-md"></span>
						</div>
					{:else}
						{#if Object.keys(fileMeta).length > 0}
							<div class="mb-4">
								<table class="table table-sm w-auto">
									<tbody>
										{#each Object.entries(fileMeta) as [key, value]}
											<tr>
												<td class="font-semibold opacity-70 pr-4">{key}</td>
												<td class="font-mono text-sm">{value}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}

						<h4 class="text-sm font-semibold opacity-70 mb-1">Preview (first 20 lines)</h4>
						<pre
							class="bg-base-200 rounded-lg p-4 overflow-x-auto text-sm font-mono whitespace-pre-wrap"
						>{preview}</pre>
					{/if}
				</div>
			{/if}
		{/if}
	</section>
</article>
