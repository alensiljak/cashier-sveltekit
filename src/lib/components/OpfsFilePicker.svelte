<script lang="ts">
	import { onMount } from 'svelte';
	import { FolderIcon, FolderOpenIcon, FileIcon, TrashIcon, RefreshCcwIcon } from '@lucide/svelte';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import type { FileTreeEntry } from '$lib/utils/opfslib.js';
	import { getManifest } from '$lib/utils/importManifest';

	type Props = {
		selectedFile?: string | null;
		showCheckboxes?: boolean;
		checkedFiles?: string[];
		showDeleteButtons?: boolean;
		onfileselect?: (entry: FileTreeEntry) => void;
		ondeleteclick?: (path: string) => void;
	};

	let {
		selectedFile = $bindable(null),
		showCheckboxes = false,
		checkedFiles = $bindable([]),
		showDeleteButtons = false,
		onfileselect,
		ondeleteclick
	}: Props = $props();

	let entries = $state<FileTreeEntry[]>([]);
	let isLoading = $state(false);
	let manifest = $state(new Map<string, { importedAt: number }>());

	export async function refresh() {
		isLoading = true;
		try {
			[entries, manifest] = await Promise.all([OpfsLib.listFileTree(), getManifest()]);
		} catch (error: any) {
			console.error('Error loading files:', error);
		} finally {
			isLoading = false;
		}
	}

	function isLocallyModified(entry: FileTreeEntry): boolean {
		if (entry.kind !== 'file' || !entry.lastModified) return false;
		const meta = manifest.get(entry.path);
		return !!meta && entry.lastModified > meta.importedAt;
	}

	onMount(refresh);

	function isEntryVisible(entry: FileTreeEntry): boolean {
		if (entry.depth === 0) return true;
		const pathParts = entry.path.split('/');
		for (let i = 1; i < pathParts.length; i++) {
			const parentPath = pathParts.slice(0, i).join('/');
			const parent = entries.find((e) => e.path === parentPath);
			if (!parent || !parent.expanded) return false;
		}
		return true;
	}

	function toggleDirectory(entry: FileTreeEntry) {
		const idx = entries.findIndex((e) => e.path === entry.path);
		if (idx === -1) return;
		entries[idx] = { ...entries[idx], expanded: !entries[idx].expanded };
	}

	function onEntryClick(entry: FileTreeEntry) {
		if (entry.kind === 'directory') {
			toggleDirectory(entry);
			return;
		}
		selectedFile = entry.path;
		onfileselect?.(entry);
	}

	function toggleCheck(path: string, event: Event) {
		event.stopPropagation();
		if (checkedFiles.includes(path)) {
			checkedFiles = checkedFiles.filter((p) => p !== path);
		} else {
			checkedFiles = [...checkedFiles, path];
		}
	}

	function formatFileSize(bytes?: number): string {
		if (bytes === undefined) return '--';
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	function formatDate(ms?: number): string {
		if (!ms) return '--';
		return new Date(ms).toLocaleString();
	}
</script>

{#if isLoading}
	<div class="flex justify-center items-center p-8">
		<span class="loading loading-spinner loading-lg"></span>
	</div>
{:else if entries.length === 0}
	<div class="alert alert-info">
		<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
		</svg>
		<span>No files found in OPFS storage.</span>
	</div>
{:else}
	<div class="flex items-center justify-between pb-1 mb-1">
		<button class="btn btn-ghost btn-xs gap-1" onclick={refresh} title="Refresh">
			<RefreshCcwIcon size={14} />
			<span class="text-xs opacity-60">Refresh</span>
		</button>
	</div>
	<table class="table table-zebra table-sm">
		<thead>
			<tr>
				{#if showCheckboxes}
					<th class="w-8"></th>
				{/if}
				<th>Name</th>
				<th>Size</th>
				<th>Last Modified</th>
				{#if showDeleteButtons}
					<th class="text-center">Actions</th>
				{/if}
			</tr>
		</thead>
		<tbody>
			{#each entries as entry}
				{#if isEntryVisible(entry)}
					<tr
						class="cursor-pointer hover"
						class:bg-secondary={selectedFile === entry.path}
						onclick={() => onEntryClick(entry)}
					>
						{#if showCheckboxes}
							<td onclick={(e) => entry.kind === 'file' && toggleCheck(entry.path, e)}>
								{#if entry.kind === 'file'}
									<input
										type="checkbox"
										class="checkbox checkbox-sm"
										checked={checkedFiles.includes(entry.path)}
										onchange={(e) => toggleCheck(entry.path, e)}
									/>
								{/if}
							</td>
						{/if}
						<td class="font-mono text-sm">
							<span class="flex items-center gap-1" style="padding-left: {entry.depth * 1.25}rem">
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
								{#if isLocallyModified(entry)}
									<span class="w-2 h-2 rounded-full bg-warning shrink-0" title="Modified locally since last sync"></span>
								{/if}
							</span>
						</td>
						<td class="text-sm">{entry.kind === 'file' ? formatFileSize(entry.size) : '--'}</td>
						<td class="text-sm">{formatDate(entry.lastModified)}</td>
						{#if showDeleteButtons}
							<td class="text-right" onclick={(e) => e.stopPropagation()}>
								{#if entry.kind === 'file'}
									<button
										class="btn btn-sm btn-error btn-outline"
										onclick={() => ondeleteclick?.(entry.path)}
									>
										<TrashIcon class="w-4 h-4" />
									</button>
								{:else}
									<button class="btn btn-sm invisible" disabled aria-hidden="true">
										<TrashIcon class="w-4 h-4" />
									</button>
								{/if}
							</td>
						{/if}
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
{/if}
