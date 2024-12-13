<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { AssetClass } from '$lib/AssetClass';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { NUMBER_FORMAT } from '$lib/constants.js';
	import { DatabaseZapIcon, FileDownIcon } from 'lucide-svelte';
	import numeral from 'numeral';
	import { onMount } from 'svelte';

	export let data;
	let _allocation: AssetClass[];

	onMount(() => {
		// console.debug(data.assetClasses?.length)
		_allocation = data.assetClasses as AssetClass[];
	});

	async function onClearCacheClick() {
		// clear from state

		await invalidateAll();
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Asset Allocation">
		{#snippet menuItems()}
			<ToolbarMenuItem text="Clear cache" Icon={DatabaseZapIcon} onclick={onClearCacheClick} />
			<ToolbarMenuItem text="Export" Icon={FileDownIcon} />
			<ToolbarMenuItem text="Validate" />
			<ToolbarMenuItem text="Help" />
		{/snippet}
	</Toolbar>

	<section class="overflow-auto p-3 table-container">
		<table class="table table-hover table-compact mx-auto">
			<thead>
				<tr>
					<th colspan="1"></th>
					<th colspan="3" style="text-align: center; border-right-width: 1px;">Allocation</th>
					<th colspan="3" style="text-align: center;">Value</th>
				</tr>
				<tr>
					<th class="text-center table-cell-fit">Asset Class</th>
					<th class="text-center table-cell-fit">Target</th>
					<th class="text-center table-cell-fit">Current</th>
					<th class="text-center table-cell-fit">Diff&nbsp;%</th>
					<th class="text-center table-cell-fit">Allocated</th>
					<th class="text-center table-cell-fit">Current</th>
					<th class="text-center table-cell-fit">Difference</th>
				</tr>
			</thead>
			<tbody>
				{#each _allocation as item}
					<tr>
						<td>
							<span class={`pl-${item.depth * 2}`}>
								{item.name}
							</span>
						</td>
						<td class="text-end">
							{numeral(item.allocation).format(NUMBER_FORMAT)}
						</td>
						<td class="text-end">
							{numeral(item.currentAllocation).format(NUMBER_FORMAT)}
						</td>
						<td class="text-end">
							{numeral(item.diffPerc).format(NUMBER_FORMAT)}
						</td>
						<td class="text-end">
							{numeral(item.allocatedValue).format(NUMBER_FORMAT)}
						</td>
						<td class="text-end">
							{numeral(item.currentValue).format(NUMBER_FORMAT)}
						</td>
						<td class="text-end">
							{numeral(item.diffAmount).format(NUMBER_FORMAT)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
</article>
