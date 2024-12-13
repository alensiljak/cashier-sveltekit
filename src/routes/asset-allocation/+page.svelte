<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { AssetClass } from '$lib/AssetClass';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { DatabaseZapIcon, FileDownIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';

	export let data;
    let _allocation: AssetClass[];

    onMount(() => {
		// console.debug(data.assetClasses?.length)
		_allocation = data.assetClasses as AssetClass[]
    })

	async function onClearCacheClick() {
		// clear from state

		await invalidateAll();
	}

</script>

<article>
	<Toolbar title="Asset Allocation">
		{#snippet menuItems()}
			<ToolbarMenuItem text="Clear cache" Icon={DatabaseZapIcon} onclick={onClearCacheClick} />
			<ToolbarMenuItem text="Export" Icon={FileDownIcon} />
			<ToolbarMenuItem text="Validate" />
			<ToolbarMenuItem text="Help" />
		{/snippet}
	</Toolbar>

	<section class="overflow-auto">
		<table class="mx-auto">
			<thead>
				<tr>
					<th colspan="1"></th>
					<th colspan="4" style="text-align: center; border-right-width: 1px;">Allocation</th>
					<th colspan="3" style="text-align: center;">Value</th>
				</tr>
				<tr>
					<th style="text-align: center;">Asset Class</th>
					<th style="text-align: center;">Target</th>
					<th style="text-align: center;">Current</th>
					<th style="text-align: center;">Diff&nbsp;%</th>
					<th style="text-align: center;">Allocated</th>
					<th style="text-align: center;">Current</th>
					<th style="text-align: center;">Difference</th>
				</tr>
			</thead>
			<tbody>
                {#each _allocation as item}
                    <tr>
                        <td>
                            {item.name}
                        </td>
						<td class="text-end">
							{item.allocation}
						</td>
						<td>
							{item.currentAllocation}
						</td>
						<td>
							{item.diffPerc}
						</td>
						<td>
							{item.allocatedValue}
						</td>
						<td>
							{item.currentValue}
						</td>
						<td>
							{item.diffAmount}
						</td>
                    </tr>
                {/each}
            </tbody>
		</table>
	</section>
</article>
