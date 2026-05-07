<script lang="ts">
	import { goto } from '$app/navigation';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { DEFAULT_FORECAST_DAYS } from '$lib/constants';
	import { selectionMetadata } from '$lib/data/mainStore';
	import { SelectionType } from '$lib/enums';
	import { SelectionModeMetadata, SettingKeys, settings } from '$lib/settings';
	import { CheckIcon, GripVerticalIcon, TrashIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let listEl = $state<HTMLElement | null>(null);

	// Drag state
	let isDragging = $state(false);
	let dragCurIndex = $state(-1);
	let ghostName = $state('');
	let ghostTop = $state(0);
	let ghostLeft = $state(0);
	let ghostWidth = $state(0);
	let ghostHeight = $state(0);
	let pointerOffsetY = 0;
	let dragBaseIndex = 0;
	let dragStartY = 0;
	let estItemHeight = 52;
	let autoScrollId: ReturnType<typeof setInterval> | null = null;

	function startDrag(e: PointerEvent, idx: number) {
		e.preventDefault();

		const handleEl = e.currentTarget as HTMLElement;
		const itemEl = handleEl.closest('[data-item]') as HTMLElement;
		const rect = itemEl.getBoundingClientRect();

		isDragging = true;
		dragCurIndex = idx;
		dragBaseIndex = idx;
		dragStartY = e.clientY;
		ghostName = accountNames[idx];
		ghostLeft = rect.left;
		ghostTop = rect.top;
		ghostWidth = rect.width;
		ghostHeight = rect.height;
		pointerOffsetY = e.clientY - rect.top;
		estItemHeight = rect.height;

		listEl?.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging || !listEl) return;

		ghostTop = e.clientY - pointerOffsetY;

		const dy = e.clientY - dragStartY;
		const targetIdx = Math.max(
			0,
			Math.min(accountNames.length - 1, Math.round(dragBaseIndex + dy / estItemHeight))
		);

		if (targetIdx !== dragCurIndex) {
			const updated = [...accountNames];
			const [moved] = updated.splice(dragCurIndex, 1);
			updated.splice(targetIdx, 0, moved);
			accountNames = updated;
			dragCurIndex = targetIdx;
		}

		const listRect = listEl.getBoundingClientRect();
		const scrollMargin = 60;
		stopAutoScroll();
		if (e.clientY < listRect.top + scrollMargin) {
			autoScrollId = setInterval(() => {
				listEl!.scrollTop -= 6;
			}, 16);
		} else if (e.clientY > listRect.bottom - scrollMargin) {
			autoScrollId = setInterval(() => {
				listEl!.scrollTop += 6;
			}, 16);
		}
	}

	function onPointerUp() {
		if (!isDragging) return;
		isDragging = false;
		dragCurIndex = -1;
		stopAutoScroll();
	}

	function stopAutoScroll() {
		if (autoScrollId !== null) {
			clearInterval(autoScrollId);
			autoScrollId = null;
		}
	}

	let days = $state(DEFAULT_FORECAST_DAYS);
	let accountNames: string[] = $state([]);

	onMount(async () => {
		await loadData();
		await handleAccountSelection();
	});

	async function loadData() {
		let accounts = await settings.get(SettingKeys.forecastAccounts);
		if (!accounts) return;

		accountNames = accounts;

		// days
		days = await settings.get(SettingKeys.forecastDays);
	}

	async function handleAccountSelection() {
		if (!$selectionMetadata) return;
		if ($selectionMetadata.selectionType !== SelectionType.ACCOUNT) return;

		let acctName = $selectionMetadata.selectedId as string;
		if (!acctName || acctName.length === 0) return;

		// reset selection mode
		selectionMetadata.set(undefined);

		accountNames.push(acctName);

		await saveSettings();
	}

	async function onAddAccountClicked() {
		const meta = new SelectionModeMetadata();
		meta.selectionType = SelectionType.ACCOUNT;
		selectionMetadata.set(meta);

		await goto('/accounts');
	}

	function onDeleteClicked(index: number) {
		accountNames.splice(index, 1);
	}

	async function onFabClicked() {
		await saveSettings();

		history.back();
	}

	async function saveSettings() {
		await settings.set(SettingKeys.forecastAccounts, accountNames);
		await settings.set(SettingKeys.forecastDays, days);
	}
</script>

<Toolbar title="Financial Forecast Settings">
	{#snippet menuItems()}
		<ToolbarMenuItem text="Add Account" onclick={onAddAccountClicked} />
	{/snippet}
</Toolbar>

<Fab Icon={CheckIcon} onclick={onFabClicked} />

<main class="p-1">
	<h4 class="h4">Forecast for days:</h4>
	<input type="number" class="input text-right" bind:value={days} />

	<h4 class="h4">Accounts</h4>

	{#if accountNames.length === 0}
		<p>No accounts selected for forecasting. Please use the menu to add.</p>
	{:else}
		<!-- Drag ghost -->
		{#if isDragging}
			<div
				class="border-base-300 bg-base-100 pointer-events-none fixed z-50 flex items-center gap-3 border px-3 shadow-xl"
				style="top: {ghostTop}px; left: {ghostLeft}px; width: {ghostWidth}px; height: {ghostHeight}px;"
			>
				<GripVerticalIcon size={20} class="text-base-content/40 shrink-0" />
				<span class="grow">{ghostName}</span>
			</div>
		{/if}

		<div
			role="list"
			class="touch-pan-y"
			bind:this={listEl}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
		>
			{#each accountNames as accountName, index}
				<div
					role="listitem"
					data-item
					class="border-base-content/15 flex w-full items-center gap-3 border-b p-2"
					class:opacity-20={isDragging && index === dragCurIndex}
				>
					<button
						type="button"
						class="text-base-content/40 touch-none cursor-grab active:cursor-grabbing"
						aria-label="Drag to reorder"
						onpointerdown={(e) => startDrag(e, index)}
					>
						<GripVerticalIcon size={22} />
					</button>
					<div class="grow">
						{accountName}
					</div>
					<button class="btn btn-error btn-icon" onclick={() => onDeleteClicked(index)}>
						<TrashIcon />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</main>
