<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { AssetAllocationEngine } from '$lib/assetAllocation/AssetAllocation.js';
	import {
		buildChildrenIndex,
		getOffsetColor,
		getRowColor
	} from '$lib/assetAllocation/assetAllocationUtils.js';
	import { validate } from '$lib/assetAllocation/assetAllocationValidation.js';
	import { AssetClass } from '$lib/assetAllocation/AssetClass.js';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import AssetClassRow from '$lib/components/AssetClassRow.svelte';
	import { NUMBER_FORMAT } from '$lib/constants.js';
	import { AaStocksStore, AssetAllocationStore } from '$lib/data/mainStore.js';
	import Notifier from '$lib/utils/notifier.js';
	import { DatabaseZapIcon, FileDownIcon, ScaleIcon } from '@lucide/svelte';
	import numeral from 'numeral';
	import { onMount } from 'svelte';

	Notifier.init();

	export let data;
	let _allocation: AssetClass[];
	let childrenIndex: Map<string, AssetClass[]> = new Map();
	let collapsedState: Record<string, boolean> = {};

	onMount(() => {
		if (!data.aa) {
			Notifier.error('Could not load Asset Allocation definition.');
			return;
		}

		_allocation = data.assetClasses as AssetClass[];
		// Build children index for hierarchical rendering
		childrenIndex = buildChildrenIndex(_allocation);
	});

	function toggleCollapse(fullname: string) {
		collapsedState[fullname] = !collapsedState[fullname];
		collapsedState = { ...collapsedState }; // Trigger reactivity
	}

	function getChildren(fullname: string): AssetClass[] {
		return childrenIndex.get(fullname) || [];
	}

	function downloadAsFile(content: string) {
		// filename
		// todo: let now = moment()
		let now = new Date();
		let filename = 'asset-allocation_';
		filename += now.toISOString().substring(0, 10);
		filename += '_';
		filename += ('' + now.getHours()).padStart(2, '0');
		filename += '-';
		filename += ('' + now.getMinutes()).padStart(2, '0');
		// filename += now.getTimezoneOffset()
		filename += '.txt';

		// Create blob with content
		const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
		const url = URL.createObjectURL(blob);

		// Create anchor element
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();

		// Cleanup
		setTimeout(() => {
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}, 100);
	}

	async function onClearCacheClick() {
		// clear from state
		AssetAllocationStore.set(undefined);
		AaStocksStore.set(undefined);

		invalidateAll();
	}

	async function onExportClick() {
		let aa = new AssetAllocationEngine();
		const output = aa.formatAllocationRowsForTxtExport(_allocation);

		downloadAsFile(output);
	}

	/**
	 * validate the allocation (definition)
	 */
	async function onValidateClick() {
		if (data.assetClasses?.length === 0) {
			Notifier.info('Please recalculate the allocation first.');
		}

		// confirm that the group allocations match the sum of the children's allocation.
		let errors = validate(data.aa!);

		if (errors.length > 0) {
			let message = 'Errors: ';
			for (let i = 0; i < errors.length; i++) {
				message += errors[i];
			}
			Notifier.error(message);
		} else {
			Notifier.success('The allocation is valid.');
		}
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Asset Allocation">
		{#snippet menuItems()}
			<ToolbarMenuItem text="Clear cache" Icon={DatabaseZapIcon} onclick={onClearCacheClick} />
			<ToolbarMenuItem text="Export" Icon={FileDownIcon} onclick={onExportClick} />
			<ToolbarMenuItem text="Validate" Icon={ScaleIcon} onclick={onValidateClick} />
			<ToolbarMenuItem text="Help" />
		{/snippet}
	</Toolbar>

	<section class="overflow-auto p-3">
		<table class="mx-auto max-w-4xl">
			<thead>
				<tr>
					<th colspan="1"></th>
					<th colspan="3" style="text-align: center; border-right-width: 1px;">Allocation</th>
					<th colspan="3" style="text-align: center;">Value</th>
				</tr>
				<tr>
					<th class="table-cell-fit px-2 text-center">Asset Class</th>
					<th class="table-cell-fit px-2 text-center">Target</th>
					<th class="table-cell-fit px-2 text-center">Current</th>
					<th class="table-cell-fit px-2 text-center">Diff %</th>
					<th class="table-cell-fit px-2 text-center">Allocated</th>
					<th class="table-cell-fit pr-2 pl-5 text-center">Current</th>
					<th class="table-cell-fit px-2 text-center">Difference</th>
				</tr>
			</thead>
			<tbody>
				{#if _allocation && _allocation.length > 0}
					{#each _allocation.filter((item) => item.depth === 0) as rootItem}
						<AssetClassRow
							assetClass={rootItem}
							children={getChildren(rootItem.fullname)}
							depth={0}
							{collapsedState}
							onToggle={toggleCollapse}
							{childrenIndex}
						/>
					{/each}
				{:else}
					<tr>
						<td colspan="7" class="py-4 text-center"> No asset allocation data available </td>
					</tr>
				{/if}
			</tbody>
		</table>
	</section>
</article>
