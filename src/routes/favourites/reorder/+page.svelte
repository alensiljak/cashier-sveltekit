<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import { CheckIcon, GripVerticalIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let favourites = $state<string[]>([]);
	let listEl = $state<HTMLElement | null>(null);

	// Ghost / drag state
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

	onMount(async () => {
		favourites = (await settings.get(SettingKeys.favouriteAccounts)) ?? [];
	});

	function startDrag(e: PointerEvent, idx: number) {
		e.preventDefault();

		const handleEl = e.currentTarget as HTMLElement;
		const itemEl = handleEl.closest('[data-item]') as HTMLElement;
		const rect = itemEl.getBoundingClientRect();

		isDragging = true;
		dragCurIndex = idx;
		dragBaseIndex = idx;
		dragStartY = e.clientY;
		ghostName = favourites[idx];
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
			Math.min(favourites.length - 1, Math.round(dragBaseIndex + dy / estItemHeight))
		);

		if (targetIdx !== dragCurIndex) {
			const updated = [...favourites];
			const [moved] = updated.splice(dragCurIndex, 1);
			updated.splice(targetIdx, 0, moved);
			favourites = updated;
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

	async function onFabClicked() {
		await settings.set(SettingKeys.favouriteAccounts, favourites);
		history.back();
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Reorder Favourites" />
	<Fab Icon={CheckIcon} onclick={onFabClicked} />

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

	<section
		role="list"
		class="grow overflow-y-auto touch-pan-y pb-24 p-1"
		bind:this={listEl}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
	>
		{#each favourites as item, index (item)}
			<div
				role="listitem"
				data-item
				class="border-base-content/25 flex h-14 flex-row items-center gap-3 rounded-lg border-b px-2"
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
				<span class="grow">{item}</span>
			</div>
		{/each}
	</section>
</article>