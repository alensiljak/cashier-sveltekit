<script lang="ts">
	import { onMount } from 'svelte';
	import { GripVerticalIcon, CheckIcon } from '@lucide/svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import { SettingKeys, settings, type AccountGroup } from '$lib/settings';

	let groups: AccountGroup[] = $state([]);
	let listEl = $state<HTMLElement | null>(null);

	// Ghost / drag state
	let isDragging = $state(false);
	let dragCurIndex = $state(-1);
	let ghostTitle = $state('');
	let ghostColor = $state('');
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
		groups = (await settings.get<AccountGroup[]>(SettingKeys.accountGroups)) ?? [];
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
		ghostTitle = groups[idx].title;
		ghostColor = groups[idx].color ?? '';
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
			Math.min(groups.length - 1, Math.round(dragBaseIndex + dy / estItemHeight))
		);

		if (targetIdx !== dragCurIndex) {
			const updated = [...groups];
			const [moved] = updated.splice(dragCurIndex, 1);
			updated.splice(targetIdx, 0, moved);
			groups = updated;
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
		settings.set(SettingKeys.accountGroups, groups);
	}

	function stopAutoScroll() {
		if (autoScrollId !== null) {
			clearInterval(autoScrollId);
			autoScrollId = null;
		}
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Reorder Groups" />

	<Fab Icon={CheckIcon} onclick={() => history.back()} />

	<!-- Drag ghost -->
	{#if isDragging}
		<div
			class="border-base-300 bg-base-100 pointer-events-none fixed z-50 flex items-center gap-3 border px-3 shadow-xl"
			style="top: {ghostTop}px; left: {ghostLeft}px; width: {ghostWidth}px; height: {ghostHeight}px;"
		>
			<GripVerticalIcon size={20} class="text-base-content/40 shrink-0" />
			<span class="grow font-medium">{ghostTitle}</span>
			{#if ghostColor}
				<div class="h-4 w-4 shrink-0 rounded-full" style="background-color: {ghostColor}"></div>
			{/if}
		</div>
	{/if}

	<section
		role="list"
		class="grow overflow-y-auto touch-pan-y"
		bind:this={listEl}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
	>
		{#each groups as group, i (group.title)}
			<div
				role="listitem"
				data-item
				class="border-base-content/15 flex items-center gap-3 border-b px-3 py-3"
				class:opacity-20={isDragging && i === dragCurIndex}
			>
				<button
					type="button"
					class="text-base-content/40 touch-none cursor-grab active:cursor-grabbing"
					aria-label="Drag to reorder"
					onpointerdown={(e) => startDrag(e, i)}
				>
					<GripVerticalIcon size={22} />
				</button>
				<span class="grow font-medium">{group.title}</span>
				{#if group.color}
					<div class="h-4 w-4 shrink-0 rounded-full" style="background-color: {group.color}"></div>
				{/if}
			</div>
		{/each}
	</section>
</article>
