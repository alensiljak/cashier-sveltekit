<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { AssetAllocationEngine } from '$lib/assetAllocation/AssetAllocation.js';
	import { validate } from '$lib/assetAllocation/assetAllocationValidation.js';
	import { AssetClass } from '$lib/assetAllocation/AssetClass.js';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { NUMBER_FORMAT } from '$lib/constants.js';
	import { AaStocksStore, AssetAllocationStore } from '$lib/data/mainStore.js';
	import Notifier from '$lib/utils/notifier.js';
	import { DatabaseZapIcon, FileDownIcon, ScaleIcon } from '@lucide/svelte';
	import numeral from 'numeral';
	import { onMount } from 'svelte';

	Notifier.init();

	export let data;
	let _allocation: AssetClass[];
	let buttonContainer: HTMLDivElement;

	onMount(() => {
		if (!data.aa) {
			Notifier.error('Could not load Asset Allocation definition.');
			return;
		}

		_allocation = data.assetClasses as AssetClass[];
	});

	function downloadAsFile(content: string) {
		var a = document.createElement('a');

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
		a.download = filename;

		let encoded = btoa(content);
		// a.href = "data:application/octet-stream;base64," + Base64.encode(this.output);
		a.href = 'data:text/plain;base64,' + encoded;
		// charset=UTF-8;

		buttonContainer.appendChild(a);
		a.click();

		// cleanup?
		buttonContainer.removeChild(a);
	}

	/**
	 * Colors the values with offset.
	 * @param value
	 */
	function getOffsetColor(value: number) {
		if (value <= -20) {
			return 'text-red-700';
		}
		if (-20 < value && value < 0) {
			return 'text-red-300';
		}
		if (0 < value && value < 20) {
			return 'text-green-300';
		}
		if (value >= 20) {
			return 'text-green-700';
		}
	}

	function getRowColor(ac: AssetClass) {
		// determine if this is an asset class by checking for symbols.
		if (ac.symbols?.length) {
			return '';
		}

		const depth = ac.depth;
		// root
		if (depth === 0) {
			return 'bg-gray-600';
		}
		// equity/fixed/real
		if (depth === 1) {
			return 'bg-gray-700';
		}
		// area
		if (depth === 2) {
			return 'bg-gray-800';
		}
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
		let errors = validate(data.aa!.assetClassIndex);

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
		<table class="mx-auto max-w-2xl">
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
				{#each _allocation as item}
					<tr class={`border-base-content/15 border-b ${getRowColor(item)}`}>
						<td>
							<span class={`pl-${item.depth * 2}`}>
								<a class="underline" href={`/assetclass-detail/${item.fullname}`}>
									{item.name}
								</a>
							</span>
						</td>
						<td class="text-end">
							{numeral(item.allocation).format(NUMBER_FORMAT)}
						</td>
						<td class="text-end">
							{numeral(item.currentAllocation).format(NUMBER_FORMAT)}
						</td>
						<td class={`text-end ${getOffsetColor(item.diffPerc)}`}>
							{numeral(item.diffPerc).format(NUMBER_FORMAT)}
						</td>
						<td class="text-end">
							{numeral(item.allocatedValue).format(NUMBER_FORMAT)}
						</td>
						<td class="text-end">
							{numeral(item.currentValue).format(NUMBER_FORMAT)}
						</td>
						<td class={`text-end ${getOffsetColor(item.diffPerc)}`}>
							{numeral(item.diffAmount).format(NUMBER_FORMAT)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
	<!-- The button is required for file export, to attach the event! -->
	<div bind:this={buttonContainer} style="display:none;">
		<button>Export</button>
	</div>
</article>
