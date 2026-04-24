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
	export let onToggle: (fullname: string) => void = () => {};
	export let childrenIndex: Map<string, AssetClass[]> = new Map();
	export let viewMode: 'allocation' | 'value' = 'allocation';

	function isCollapsible(ac: AssetClass): boolean {
		return !ac.symbols?.length && children.length > 0;
	}

	function toggleCollapse() {
		if (isCollapsible(assetClass)) {
			onToggle(assetClass.fullname);
		}
	}

	function getIndentClass() {
		const indentClasses = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20'];
		return indentClasses[depth] || indentClasses[indentClasses.length - 1];
	}

	function getBorderClass() {
		if (depth === 0) return '';
		return 'border-l border-base-300';
	}

	function getChildren(fullname: string): AssetClass[] {
		return childrenIndex.get(fullname) || [];
	}

	$: allocHidden = viewMode !== 'allocation' ? ' hidden lg:table-cell' : '';
	$: valueHidden = viewMode !== 'value' ? ' hidden lg:table-cell' : '';
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
	<td class="text-end{allocHidden}">
		{numeral(assetClass.allocation).format(NUMBER_FORMAT)}
	</td>
	<td class="text-end{allocHidden}">
		{numeral(assetClass.currentAllocation).format(NUMBER_FORMAT)}
	</td>
	<td class="text-end{allocHidden} {getOffsetColor(assetClass.diffPerc)}">
		{numeral(assetClass.diffPerc).format(NUMBER_FORMAT)}
	</td>
	<td class="text-end{valueHidden}">
		{numeral(assetClass.allocatedValue).format(NUMBER_FORMAT)}
	</td>
	<td class="text-end{valueHidden}">
		{numeral(assetClass.currentValue).format(NUMBER_FORMAT)}
	</td>
	<td class="pr-1 text-end{valueHidden} {getOffsetColor(assetClass.diffPerc)}">
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
			{viewMode}
		/>
	{/each}
{/if}
