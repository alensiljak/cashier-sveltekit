<script lang="ts">
	import { onMount } from 'svelte';
	import { RefreshCw } from '@lucide/svelte';
	import OpfsTreeNode from './OpfsTreeNode.svelte';
	import type { OpfsTreeNode as TreeNodeType } from '$lib/data/opfsTypes';

	let tree = $state<TreeNodeType[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	async function readDir(dirHandle: FileSystemDirectoryHandle): Promise<TreeNodeType[]> {
		const nodes: TreeNodeType[] = [];
		for await (const [name, handle] of dirHandle) {
			if (handle.kind === 'directory') {
				const children = await readDir(handle as FileSystemDirectoryHandle);
				nodes.push({ name, kind: 'directory', children, expanded: false });
			} else {
				nodes.push({ name, kind: 'file' });
			}
		}
		nodes.sort((a, b) => {
			if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
		return nodes;
	}

	async function load() {
		loading = true;
		error = null;
		try {
			const root = await navigator.storage.getDirectory();
			tree = await readDir(root);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to read OPFS';
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<div class="flex flex-col gap-1">
	<div class="flex items-center justify-between pb-1">
		<span class="font-semibold opacity-60">Files</span>
		<button
			class="btn btn-ghost btn-xs"
			onclick={load}
			title="Refresh"
		>
			<RefreshCw size={14} />
		</button>
	</div>

	{#if loading}
		<div class="flex items-center gap-2 py-4 opacity-50">
			<span class="loading loading-spinner loading-xs"></span>
			Loading…
		</div>
	{:else if error}
		<div class="alert alert-error">
			<span>{error}</span>
		</div>
	{:else if tree.length === 0}
		<p class="py-4 opacity-50">No files found in OPFS.</p>
	{:else}
		<ul class="menu p-0">
			{#each tree as node}
				<OpfsTreeNode {node} />
			{/each}
		</ul>
	{/if}
</div>
