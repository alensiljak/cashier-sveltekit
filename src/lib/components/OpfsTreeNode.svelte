<script lang="ts">
	import { Folder, FolderOpen, File, ChevronRight, ChevronDown } from '@lucide/svelte';

	import type { OpfsTreeNode } from '$lib/data/opfsTypes';
	import Self from './OpfsTreeNode.svelte';

	let { node }: { node: OpfsTreeNode } = $props();

	function toggle() {
		node.expanded = !node.expanded;
	}
</script>

{#if node.kind === 'directory'}
	<li>
		<button
			class="flex w-full items-center gap-1 text-left"
			onclick={toggle}
		>
			<span class="text-base-content/40">
				{#if node.expanded}
					<ChevronDown size={14} />
				{:else}
					<ChevronRight size={14} />
				{/if}
			</span>
			<span class="text-warning">
				{#if node.expanded}
					<FolderOpen size={15} />
				{:else}
					<Folder size={15} />
				{/if}
			</span>
			<span>{node.name}</span>
		</button>
		{#if node.expanded && node.children && node.children.length > 0}
			<ul>
				{#each node.children as child}
					<Self node={child} />
				{/each}
			</ul>
		{/if}
	</li>
{:else}
	<li>
		<span class="flex items-center gap-1">
			<span class="w-[14px]"></span>
			<span class="text-info">
				<File size={15} />
			</span>
			<span>{node.name}</span>
		</span>
	</li>
{/if}