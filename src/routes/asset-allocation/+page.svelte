<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { AssetAllocationEngine } from '$lib/assetAllocation/AssetAllocation.js';
	import { buildChildrenIndex } from '$lib/assetAllocation/assetAllocationUtils.js';
	import { validate } from '$lib/assetAllocation/assetAllocationValidation.js';
	import { AssetClass } from '$lib/assetAllocation/AssetClass.js';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import AssetClassRow from '$lib/components/AssetClassRow.svelte';
	import { AaStocksStore, AssetAllocationStore, AssetAllocationLoadedAtStore } from '$lib/data/mainStore.js';
	import Notifier from '$lib/utils/notifier.js';
	import { RefreshCwIcon, FileDownIcon, ScaleIcon } from '@lucide/svelte';

	Notifier.init();

	let { data } = $props();
	let _allocation = $state<AssetClass[]>([]);
	let childrenIndex = $state(new Map<string, AssetClass[]>());
	let collapsedState = $state<Record<string, boolean>>({});
	let viewMode = $state<'allocation' | 'value'>('allocation');

	$effect(() => {
		if (data.aa && data.assetClasses?.length) {
			const alloc = data.assetClasses as AssetClass[];
			_allocation = alloc;
			childrenIndex = buildChildrenIndex(alloc);
		} else if (!data.aa) {
			Notifier.error('Could not load Asset Allocation definition.');
		}
	});

	function toggleCollapse(fullname: string) {
		collapsedState[fullname] = !collapsedState[fullname];
	}

	function getChildren(fullname: string): AssetClass[] {
		return childrenIndex.get(fullname) || [];
	}

	function downloadAsFile(content: string) {
		let now = new Date();
		let filename = 'asset-allocation_';
		filename += now.toISOString().substring(0, 10);
		filename += '_';
		filename += ('' + now.getHours()).padStart(2, '0');
		filename += '-';
		filename += ('' + now.getMinutes()).padStart(2, '0');
		filename += '.txt';

		const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
		const url = URL.createObjectURL(blob);

		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();

		requestIdleCallback(
			() => {
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			},
			{ timeout: 2000 }
		);
	}

	async function onRefreshClick() {
		AssetAllocationStore.set(undefined);
		AaStocksStore.set(undefined);
		AssetAllocationLoadedAtStore.set(undefined);
		invalidateAll();
	}

	async function onExportClick() {
		let aa = new AssetAllocationEngine();
		const output = aa.formatAllocationRowsForTxtExport(_allocation);
		downloadAsFile(output);
	}

	async function onValidateClick() {
		if (data.assetClasses?.length === 0) {
			Notifier.info('Please recalculate the allocation first.');
		}
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
			<ToolbarMenuItem text="Export" Icon={FileDownIcon} onclick={onExportClick} />
			<ToolbarMenuItem text="Validate" Icon={ScaleIcon} onclick={onValidateClick} />
			<ToolbarMenuItem text="Help" />
		{/snippet}
	</Toolbar>

	<!-- View mode toggle — small screens only -->
	<div class="lg:hidden shrink-0 flex items-center justify-center bg-primary py-1.5">
		<div class="view-toggle">
			<button
				class="view-toggle-btn"
				class:active={viewMode === 'allocation'}
				onclick={() => (viewMode = 'allocation')}
			>%</button>
			<button
				class="view-toggle-btn"
				class:active={viewMode === 'value'}
				onclick={() => (viewMode = 'value')}
			>###</button>
		</div>
	</div>

	<section class="p-3">
		<table class="mx-auto max-w-4xl">
			<thead>
				<tr>
					<th colspan="1"></th>
					<th
						colspan="3"
						class="text-center border-r{viewMode !== 'allocation' ? ' hidden' : ''} lg:table-cell"
					>Allocation</th>
					<th
						colspan="3"
						class="text-center{viewMode !== 'value' ? ' hidden' : ''} lg:table-cell"
					>Value</th>
				</tr>
				<tr>
					<th class="table-cell-fit px-2 text-center">Asset Class</th>
					<th class="table-cell-fit px-2 text-center{viewMode !== 'allocation' ? ' hidden' : ''} lg:table-cell">Target</th>
					<th class="table-cell-fit px-2 text-center{viewMode !== 'allocation' ? ' hidden' : ''} lg:table-cell">Current</th>
					<th class="table-cell-fit px-2 text-center{viewMode !== 'allocation' ? ' hidden' : ''} lg:table-cell">Diff %</th>
					<th class="table-cell-fit px-2 text-center{viewMode !== 'value' ? ' hidden' : ''} lg:table-cell">Allocated</th>
					<th class="table-cell-fit pr-2 pl-5 text-center{viewMode !== 'value' ? ' hidden' : ''} lg:table-cell">Current</th>
					<th class="table-cell-fit px-2 text-center{viewMode !== 'value' ? ' hidden' : ''} lg:table-cell">Difference</th>
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
							{viewMode}
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

	<footer class="flex shrink-0 items-center justify-end gap-2 border-t border-base-300 px-3 py-1 text-xs text-base-content/50">
		{#if $AssetAllocationLoadedAtStore}
			<span>Loaded at {$AssetAllocationLoadedAtStore.toLocaleTimeString()}</span>
		{:else}
			<span>Not loaded</span>
		{/if}
		<button class="btn btn-ghost btn-xs" onclick={onRefreshClick} title="Reload">
			<RefreshCwIcon size={14} />
		</button>
	</footer>
</article>

<style>
	.view-toggle {
		display: flex;
		border-radius: 0.25rem;
		overflow: hidden;
		border: 1px solid var(--color-primary-900);
	}

	.view-toggle-btn {
		padding: 0.25rem 1.25rem;
		background-color: var(--color-primary-700);
		color: var(--color-accent-200);
		font-size: 0.85rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		cursor: pointer;
		border: none;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.07);
		transition:
			background-color 0.1s,
			box-shadow 0.1s;
	}

	.view-toggle-btn:not(:last-child) {
		border-right: 1px solid var(--color-primary-900);
	}

	.view-toggle-btn.active {
		background-color: var(--color-primary-950);
		box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.55);
	}

	.view-toggle-btn:hover:not(.active) {
		background-color: var(--color-primary-600);
	}
</style>
