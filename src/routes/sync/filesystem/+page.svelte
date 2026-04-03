<!--
* Synchronization of the OPFS ledger storage with a directory on the
* current device. This requires File System API access, provided by
* Chromium-based browsers.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import {
		RefreshCcwIcon,
		FolderOpenIcon,
		FileIcon,
		FolderIcon,
		BookOpenIcon,
		XIcon,
		TriangleAlertIcon
	} from '@lucide/svelte';
	import Notifier from '$lib/utils/notifier';
	import { settings, SettingKeys } from '$lib/settings';
	import Fab from '$lib/components/FAB.svelte';

	Notifier.init();

	// IndexedDB persistence for directory handle (same mechanism as settings page)
	const IDB_NAME = 'cashier-fs-handles';
	const IDB_STORE = 'handles';
	const HANDLE_KEY = 'fsSyncDirectoryHandle';

	interface EntryInfo {
		name: string;
		kind: 'file' | 'directory';
		path: string; // relative path from dirHandle root, e.g. "subdir/file.beancount"
		depth: number; // nesting level for indentation
		size?: number;
		lastModified?: number;
		expanded?: boolean;
	}

	let dirHandle = $state<FileSystemDirectoryHandle | null>(null);
	let dirName = $state('');
	let entries = $state<EntryInfo[]>([]);
	let isLoading = $state(false);
	let selectedEntry = $state<EntryInfo | null>(null);
	let preview = $state('');
	let isPreviewLoading = $state(false);
	let fileMeta = $state<Record<string, string>>({});
	let showPreviewPanel = $state(false);
	let bookRootFileName = $state(''); // full path as stored in settings, e.g. "dirname/sub/file.beancount"
	let aaDefinitionFileName = $state(''); // same

	onMount(async () => {
		const fullBookRoot = await settings.get<string>(SettingKeys.fullBookRoot);
		bookRootFileName = fullBookRoot ?? '';

		const aaDef = await settings.get<string>(SettingKeys.assetAllocationDefinition);
		aaDefinitionFileName = aaDef ?? '';

		const stored = await loadPersistedHandle();
		if (stored) {
			try {
				const permission = await (stored as any).requestPermission({ mode: 'read' });
				if (permission === 'granted') {
					dirHandle = stored;
					dirName = stored.name;
					await loadEntries();
				}
			} catch {
				// Permission denied or unavailable
			}
		}
	});

	async function pickDirectory() {
		try {
			dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
			dirName = dirHandle!.name;
			await persistHandle(dirHandle!);
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
		showPreviewPanel = false;

		try {
			const list: EntryInfo[] = [];

			for await (const [name, handle] of (dirHandle as any).entries()) {
				const info: EntryInfo = { name, kind: handle.kind, path: name, depth: 0 };

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

	async function getDirHandleAtPath(relPath: string): Promise<FileSystemDirectoryHandle> {
		const parts = relPath.split('/');
		let current = dirHandle!;
		for (const part of parts) {
			current = await current.getDirectoryHandle(part);
		}
		return current;
	}

	async function getFileHandleAtPath(relPath: string): Promise<FileSystemFileHandle> {
		const parts = relPath.split('/');
		let current = dirHandle!;
		for (let i = 0; i < parts.length - 1; i++) {
			current = await current.getDirectoryHandle(parts[i]);
		}
		return current.getFileHandle(parts[parts.length - 1]);
	}

	async function toggleDirectory(entry: EntryInfo) {
		if (entry.expanded) {
			// Collapse: remove all descendants whose path starts with this dir's path
			const prefix = entry.path + '/';
			entries = entries
				.map((e) => (e.path === entry.path ? { ...e, expanded: false } : e))
				.filter((e) => !e.path.startsWith(prefix));
		} else {
			// Expand: load children and insert after the directory row
			const idx = entries.findIndex((e) => e.path === entry.path);
			if (idx === -1) return;

			try {
				const subDir = await getDirHandleAtPath(entry.path);
				const children: EntryInfo[] = [];

				for await (const [name, handle] of (subDir as any).entries()) {
					const info: EntryInfo = {
						name,
						kind: handle.kind,
						path: `${entry.path}/${name}`,
						depth: entry.depth + 1
					};
					if (handle.kind === 'file') {
						try {
							const file = await (handle as FileSystemFileHandle).getFile();
							info.size = file.size;
							info.lastModified = file.lastModified;
						} catch {
							// metadata unavailable
						}
					}
					children.push(info);
				}

				children.sort((a, b) => {
					if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
					return a.name.localeCompare(b.name);
				});

				const newEntries = [...entries];
				newEntries[idx] = { ...newEntries[idx], expanded: true };
				newEntries.splice(idx + 1, 0, ...children);
				entries = newEntries;
			} catch (error: any) {
				console.error('Error reading directory:', error);
				Notifier.error(error.message || 'Failed to read directory');
			}
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
			'.beancount',
			'.bean',
			'.ledger',
			'.journal',
			'.txt',
			'.md',
			'.csv',
			'.json',
			'.xml',
			'.html',
			'.css',
			'.js',
			'.ts',
			'.svelte',
			'.yaml',
			'.yml',
			'.toml',
			'.ini',
			'.cfg',
			'.conf',
			'.log',
			'.sh',
			'.bat',
			'.py',
			'.rs',
			'.go',
			'.java',
			'.c',
			'.cpp',
			'.h',
			'.ledger',
			'.journal',
			'.dat',
			'.env',
			'.gitignore',
			'.editorconfig'
		];
		const lower = name.toLowerCase();
		return textExtensions.some((ext) => lower.endsWith(ext)) || !lower.includes('.');
	}

	async function onEntryClick(entry: EntryInfo) {
		if (entry.kind === 'directory') {
			await toggleDirectory(entry);
			return;
		}
		if (!dirHandle) return;

		selectedEntry = entry;
		isPreviewLoading = true;
		preview = '';
		fileMeta = {};
		showPreviewPanel = true;

		try {
			const fileHandle = await getFileHandleAtPath(entry.path);
			const file = await fileHandle.getFile();

			// Collect metadata
			const meta: Record<string, string> = {};
			meta['Name'] = file.name;
			meta['Path'] = entry.path;
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

	function openIdb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = indexedDB.open(IDB_NAME, 1);
			req.onupgradeneeded = () => {
				req.result.createObjectStore(IDB_STORE);
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	async function persistHandle(handle: FileSystemDirectoryHandle): Promise<void> {
		const db = await openIdb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readwrite');
			tx.objectStore(IDB_STORE).put(handle, HANDLE_KEY);
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => {
				db.close();
				reject(tx.error);
			};
		});
	}

	async function loadPersistedHandle(): Promise<FileSystemDirectoryHandle | null> {
		try {
			const db = await openIdb();
			return new Promise((resolve, reject) => {
				const tx = db.transaction(IDB_STORE, 'readonly');
				const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY);
				req.onsuccess = () => {
					db.close();
					resolve(req.result ?? null);
				};
				req.onerror = () => {
					db.close();
					reject(req.error);
				};
			});
		} catch {
			return null;
		}
	}

	async function selectBookFile() {
		if (!selectedEntry || selectedEntry.kind !== 'file') return;
		const fullPath = `${dirName}/${selectedEntry.path}`;
		await settings.set(SettingKeys.fullBookRoot, fullPath);
		bookRootFileName = fullPath;
		Notifier.success(`Book file set to: ${selectedEntry.path}`);
	}

	async function selectAssetAllocationFile() {
		if (!selectedEntry || selectedEntry.kind !== 'file') return;
		const fullPath = `${dirName}/${selectedEntry.path}`;
		await settings.set(SettingKeys.assetAllocationDefinition, fullPath);
		aaDefinitionFileName = fullPath;
		Notifier.success(`Asset Allocation file set to: ${selectedEntry.path}`);
	}

	function onFab() {
		history.back();
	}
</script>

<article>
	<Toolbar title="File System Synchronization">
		{#snippet menuItems()}
			<li>
				<button class="btn btn-sm btn-ghost gap-2" onclick={pickDirectory}>
					<FolderOpenIcon class="w-5 h-5" />
					<span>Open Directory</span>
				</button>
			</li>
			{#if dirHandle}
				<li>
					<button class="btn btn-sm btn-ghost gap-2" onclick={loadEntries} disabled={isLoading}>
						<RefreshCcwIcon class="w-5 h-5 {isLoading ? 'animate-spin' : ''}" />
						<span>Refresh</span>
					</button>
				</li>
				<li>
					<button
						class="btn btn-sm btn-ghost gap-2"
						onclick={selectBookFile}
						disabled={!selectedEntry || selectedEntry.kind !== 'file'}
					>
						<BookOpenIcon class="w-5 h-5" />
						<span>Set book file</span>
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
				({entries.filter((e) => e.depth === 0).length} entries)
			</p>

			<!-- Filesystem Treeview -->
			<div class="mb-4 overflow-x-auto overflow-y-auto" style="height: 400px;">
				<table class="table table-zebra table-sm">
					<thead>
						<tr>
							<th>Name</th>
							<th>Size</th>
							<th>Last Modified</th>
						</tr>
					</thead>
					<tbody>
						{#each entries as entry}
							<tr
								class="cursor-pointer hover"
								class:bg-secondary={selectedEntry?.path === entry.path}
								class:book-root-row={`${dirName}/${entry.path}` === bookRootFileName &&
									selectedEntry?.path !== entry.path}
								onclick={() => onEntryClick(entry)}
							>
								<td class="font-mono text-sm">
									<span
										class="flex items-center gap-1"
										style="padding-left: {entry.depth * 1.25}rem"
									>
										{#if entry.kind === 'directory'}
											{#if entry.expanded}
												<FolderOpenIcon class="w-4 h-4 opacity-60 shrink-0" />
											{:else}
												<FolderIcon class="w-4 h-4 opacity-60 shrink-0" />
											{/if}
										{:else}
											<FileIcon class="w-4 h-4 opacity-60 shrink-0" />
										{/if}
										{entry.name}
									</span>
								</td>
								<td class="text-sm">{entry.kind === 'file' ? formatSize(entry.size) : '--'}</td>
								<td class="text-sm">{formatDate(entry.lastModified)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if !bookRootFileName || !aaDefinitionFileName}
				<div class="flex flex-col gap-2 mt-4">
					{#if !bookRootFileName}
						<div role="alert" class="alert alert-warning">
							<TriangleAlertIcon class="w-5 h-5 shrink-0" />
							<span>Book not selected. Please select the book file from the list above.</span>
							<button
								class="btn btn-sm btn-warning"
								onclick={selectBookFile}
								disabled={!selectedEntry || selectedEntry.kind !== 'file'}
							>
								Set Book
							</button>
						</div>
					{/if}
					{#if !aaDefinitionFileName}
						<div role="alert" class="alert alert-warning">
							<TriangleAlertIcon class="w-5 h-5 shrink-0" />
							<span
								>Asset Allocation not set. Please select the Asset Allocation definition file from
								the list above.</span
							>
							<button
								class="btn btn-sm btn-warning"
								onclick={selectAssetAllocationFile}
								disabled={!selectedEntry || selectedEntry.kind !== 'file'}
							>
								Set Asset Allocation
							</button>
						</div>
					{/if}
				</div>
			{/if}

			{#if selectedEntry && showPreviewPanel}
				<div class="mt-6 border border-base-300 rounded-lg">
					<!-- Panel header -->
					<div
						class="flex items-center justify-between px-4 py-2 border-b border-base-300 bg-base-200 rounded-t-lg"
					>
						<h3 class="text-lg font-semibold">{selectedEntry.name}</h3>
						<button
							class="btn btn-sm btn-ghost btn-square"
							onclick={() => {
								showPreviewPanel = false;
								selectedEntry = null;
							}}
							aria-label="Close preview"
						>
							<XIcon class="w-4 h-4" />
						</button>
					</div>
					<div class="p-4">
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
								class="bg-base-200 rounded-lg p-4 overflow-x-auto text-sm font-mono whitespace-pre-wrap">{preview}</pre>
						{/if}
					</div>
				</div>
			{/if}
		{/if}
	</section>

	<Fab onclick={onFab} />
</article>

<style>
	.book-root-row {
		background-color: color-mix(in oklch, var(--color-primary) 25%, transparent);
	}
</style>
