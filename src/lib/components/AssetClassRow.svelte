<script lang="ts">
	import { AssetClass } from '$lib/assetAllocation/AssetClass.js';
	import { getOffsetColor, getRowColor } from '$lib/assetAllocation/assetAllocationUtils.js';
	import { NUMBER_FORMAT } from '$lib/constants.js';
	import numeral from 'numeral';
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import AssetClassRow from './AssetClassRow.svelte';

	export let assetClass: AssetClass;
	export let children: AssetClass[] = [];
	export let depth: number = 0;
	export let collapsedState: Record<string, boolean> = {};
	export let onToggle: (fullname: string) => void;
	export let childrenIndex: Map<string, AssetClass[]> = new Map();

	function isCollapsible(ac: AssetClass): boolean {
		// Asset classes with symbols are leaf nodes and not collapsible
		return !ac.symbols?.length && children.length > 0;
	}

	function toggleCollapse() {
		if (isCollapsible(assetClass)) {
			onToggle(assetClass.fullname);
		}
	}

	function getIndentClass() {
		// Use standard Tailwind padding classes that are guaranteed to exist
		const indentClasses = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20'];
		return indentClasses[depth] || indentClasses[indentClasses.length - 1];
	}

	function getBorderClass() {
		if (depth === 0) return '';
		// Add border-left for nested items to create tree visual hierarchy
		return 'border-l border-base-300';
	}

	function getChildren(fullname: string): AssetClass[] {
		return childrenIndex.get(fullname) || [];
	}
</script>

<!-- Row for this asset class -->
<tr class="border-base-content/15 border-b {getRowColor(assetClass)} {getBorderClass()}">
	<td class="py-0.5">
		<div class="flex min-w-0 items-center">
			{#if isCollapsible(assetClass)}
				<button
					class="hover:bg-base-300 mr-2 rounded p-1 transition-colors duration-200"
					on:click|preventDefault|stopPropagation={toggleCollapse}
				>
					{#if collapsedState[assetClass.fullname]}
						<ChevronRight class="h-4 w-4" />
					{:else}
						<ChevronDown class="h-4 w-4" />
					{/if}
				</button>
			{/if}
			{#if depth > 0}
				<!-- Visual indentation guides -->
				<div class="flex">
					{#each Array(depth).fill(0) as _, i}
						<div class="border-base-300 mr-1 h-full w-2 border-l"></div>
					{/each}
				</div>
			{/if}
			<span class="truncate">
				<a class="underline" href={`/assetclass-detail/${assetClass.fullname}`}>
					{assetClass.name}
				</a>
			</span>
		</div>
	</td>
	<td class="text-end">
		{numeral(assetClass.allocation).format(NUMBER_FORMAT)}
	</td>
	<td class="text-end">
		{numeral(assetClass.currentAllocation).format(NUMBER_FORMAT)}
	</td>
	<td class={`text-end ${getOffsetColor(assetClass.diffPerc)}`}>
		{numeral(assetClass.diffPerc).format(NUMBER_FORMAT)}
	</td>
	<td class="text-end">
		{numeral(assetClass.allocatedValue).format(NUMBER_FORMAT)}
	</td>
	<td class="text-end">
		{numeral(assetClass.currentValue).format(NUMBER_FORMAT)}
	</td>
	<td class={`pr-1 text-end ${getOffsetColor(assetClass.diffPerc)}`}>
		{numeral(assetClass.diffAmount).format(NUMBER_FORMAT)}
	</td>
</tr>

<!-- Recursively render children -->
{#if children.length > 0 && !collapsedState[assetClass.fullname]}
	{#each children as child}
		<AssetClassRow
			assetClass={child}
			children={getChildren(child.fullname)}
			depth={depth + 1}
			{collapsedState}
			{onToggle}
			{childrenIndex}
		/>
	{/each}
{/if}
