<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import Notifier from '$lib/utils/notifier';
	import { settings, SettingKeys } from '$lib/settings';
	import { WebDavClient, type WebDavEntry } from '$lib/utils/webdav';
	import {
		SettingsIcon,
		RefreshCwIcon,
		FolderIcon,
		FileIcon,
		DownloadIcon,
		UploadIcon,
		TrashIcon,
		FolderPlusIcon,
		ChevronRightIcon,
		CloudIcon
	} from '@lucide/svelte';

	let url = $state('');
	let username = $state('');
	let password = $state('');
	/** Path segments below the configured root. */
	let segments = $state<string[]>([]);
	let entries = $state<WebDavEntry[]>([]);
	let isLoading = $state(false);
	let isBusy = $state(false);
	let toDelete = $state<WebDavEntry | null>(null);
	let showNewFolder = $state(false);
	let newFolderName = $state('');
	let fileInput: HTMLInputElement | undefined = $state();

	const currentPath = $derived(segments.join('/'));
	// Folders first, then by name.
	const sorted = $derived(
		[...entries].sort(
			(a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name)
		)
	);

	onMount(async () => {
		const saved = await settings.get<{ url: string; username: string; password: string }>(
			SettingKeys.webdavSettings
		);
		url = saved?.url ?? '';
		username = saved?.username ?? '';
		password = saved?.password ?? '';
		if (url) await refresh();
	});

	function client() {
		return new WebDavClient(url, username, password);
	}

	function pathOf(name: string): string {
		return currentPath ? `${currentPath}/${name}` : name;
	}

	async function refresh() {
		isLoading = true;
		try {
			entries = await client().list(currentPath);
		} catch (err) {
			entries = [];
			Notifier.error('Listing failed: ' + (err as Error).message);
		} finally {
			isLoading = false;
		}
	}

	async function goTo(depth: number) {
		segments = segments.slice(0, depth);
		await refresh();
	}

	async function open(entry: WebDavEntry) {
		if (!entry.isDirectory) return;
		segments = [...segments, entry.name];
		await refresh();
	}

	async function download(entry: WebDavEntry) {
		isBusy = true;
		try {
			const res = await client().get(pathOf(entry.name));
			if (!res.ok) {
				Notifier.error(`Download failed: ${res.status} ${res.statusText}`);
				return;
			}
			const objectUrl = URL.createObjectURL(await res.blob());
			const a = document.createElement('a');
			a.href = objectUrl;
			a.download = entry.name;
			a.click();
			URL.revokeObjectURL(objectUrl);
		} catch (err) {
			Notifier.error('Download error: ' + (err as Error).message);
		} finally {
			isBusy = false;
		}
	}

	async function onFilesChosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (files.length === 0) return;
		isBusy = true;
		try {
			for (const file of files) {
				const bytes = new Uint8Array(await file.arrayBuffer());
				const res = await client().put(
					pathOf(file.name),
					bytes,
					file.type || 'application/octet-stream'
				);
				if (res.ok) Notifier.success(`Uploaded ${file.name}`);
				else Notifier.error(`Upload failed for ${file.name}: ${res.status} ${res.statusText}`);
			}
		} catch (err) {
			Notifier.error('Upload error: ' + (err as Error).message);
		} finally {
			isBusy = false;
			await refresh();
		}
	}

	async function confirmDelete() {
		const entry = toDelete;
		toDelete = null;
		if (!entry) return;
		isBusy = true;
		try {
			// A directory needs a trailing slash so the server treats it as a collection.
			const res = await client().delete(pathOf(entry.name) + (entry.isDirectory ? '/' : ''));
			if (res.ok) Notifier.success(`Deleted ${entry.name}`);
			else Notifier.error(`Delete failed: ${res.status} ${res.statusText}`);
		} catch (err) {
			Notifier.error('Delete error: ' + (err as Error).message);
		} finally {
			isBusy = false;
			await refresh();
		}
	}

	async function createFolder() {
		const name = newFolderName.trim();
		if (!name || name.includes('/')) {
			Notifier.error('Enter a folder name without slashes');
			return;
		}
		showNewFolder = false;
		newFolderName = '';
		isBusy = true;
		try {
			const res = await client().mkcol(pathOf(name));
			if (res.ok) Notifier.success(`Created ${name}`);
			else Notifier.error(`Create folder failed: ${res.status} ${res.statusText}`);
		} catch (err) {
			Notifier.error('Create folder error: ' + (err as Error).message);
		} finally {
			isBusy = false;
			await refresh();
		}
	}

	function formatFileSize(bytes: number | null): string {
		if (bytes == null) return '--';
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	function formatDate(d: Date | null): string {
		return d ? d.toLocaleString() : '--';
	}
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="WebDAV Explorer">
		{#snippet actions()}
			<a
				href="/settings/webdav-cfg"
				class="btn btn-ghost btn-sm btn-square"
				aria-label="WebDAV Config"
				title="WebDAV Config"
			>
				<SettingsIcon size={20} />
			</a>
		{/snippet}
		{#snippet menuItems()}
			<ToolbarMenuItem
				text="Upload File"
				Icon={UploadIcon}
				disabled={!url || isBusy}
				onclick={() => fileInput?.click()}
			/>
			<ToolbarMenuItem
				text="New Folder"
				Icon={FolderPlusIcon}
				disabled={!url || isBusy}
				onclick={() => (showNewFolder = true)}
			/>
		{/snippet}
	</Toolbar>

	<input bind:this={fileInput} type="file" multiple class="hidden" onchange={onFilesChosen} />

	<section class="flex-1 overflow-hidden p-4">
		{#if !url}
			<p>
				Make sure that you <a href="/settings/webdav-cfg" class="link link-primary">configure</a> your
				WebDAV connection first.
			</p>
		{:else}
			<div class="overflow-x-auto overflow-y-auto h-full">
				<div class="flex items-center justify-between pb-1 mb-1">
					<nav class="flex flex-wrap items-center gap-1 text-sm" aria-label="Path">
						<button class="btn btn-ghost btn-xs gap-1" onclick={() => goTo(0)}>
							<CloudIcon size={14} /> root
						</button>
						{#each segments as seg, i}
							<ChevronRightIcon size={14} class="text-base-content/40" />
							<button class="btn btn-ghost btn-xs" onclick={() => goTo(i + 1)}>{seg}</button>
						{/each}
					</nav>
					<button class="btn btn-ghost btn-xs gap-1" onclick={refresh} title="Refresh">
						<RefreshCwIcon size={14} class={isLoading ? 'animate-spin' : ''} />
						<span class="text-xs opacity-60">Refresh</span>
					</button>
				</div>

				{#if isLoading && entries.length === 0}
					<div class="flex justify-center items-center p-8">
						<span class="loading loading-spinner loading-lg"></span>
					</div>
				{:else if entries.length === 0}
					<div class="alert alert-info"><span>This folder is empty.</span></div>
				{:else}
					<table class="table table-zebra table-sm">
						<thead>
							<tr>
								<th>Name</th>
								<th>Size</th>
								<th>Last Modified</th>
								<th class="text-center">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each sorted as entry (entry.name)}
								<tr
									class="hover:bg-base-300 has-[.btn-error:hover]:bg-error/20"
									class:cursor-pointer={entry.isDirectory}
									onclick={() => open(entry)}
								>
									<td class="font-mono text-sm">
										<span class="flex items-center gap-1">
											{#if entry.isDirectory}
												<FolderIcon class="w-4 h-4 opacity-60 shrink-0" />
											{:else}
												<FileIcon class="w-4 h-4 opacity-60 shrink-0" />
											{/if}
											{entry.name}
										</span>
									</td>
									<td class="text-sm">{entry.isDirectory ? '--' : formatFileSize(entry.size)}</td>
									<td class="text-sm">{formatDate(entry.lastModified)}</td>
									<td class="text-right whitespace-nowrap" onclick={(e) => e.stopPropagation()}>
										{#if !entry.isDirectory}
											<button
												class="btn btn-sm btn-outline"
												aria-label="Download {entry.name}"
												title="Download"
												disabled={isBusy}
												onclick={() => download(entry)}
											>
												<DownloadIcon class="w-4 h-4" />
											</button>
										{/if}
										<button
											class="btn btn-sm btn-error btn-outline"
											aria-label="Delete {entry.name}"
											title="Delete"
											disabled={isBusy}
											onclick={() => (toDelete = entry)}
										>
											<TrashIcon class="w-4 h-4" />
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		{/if}
	</section>
</main>
{#if toDelete}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">Confirm Delete</h3>
			<p class="py-4">
				Delete <strong class="font-mono">{toDelete.name}</strong> from the server?
				{#if toDelete.isDirectory}
					<span class="text-error">The folder and everything inside it will be removed.</span>
				{/if}
			</p>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => (toDelete = null)}>Cancel</button>
				<button class="btn btn-error" onclick={confirmDelete}>Delete</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (toDelete = null)}></button>
	</div>
{/if}

{#if showNewFolder}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">New Folder</h3>
			<input
				type="text"
				class="input input-bordered w-full mt-4"
				placeholder="Folder name"
				bind:value={newFolderName}
				onkeydown={(e) => e.key === 'Enter' && createFolder()}
			/>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => (showNewFolder = false)}>Cancel</button>
				<button class="btn btn-primary" onclick={createFolder}>Create</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (showNewFolder = false)}></button>
	</div>
{/if}
