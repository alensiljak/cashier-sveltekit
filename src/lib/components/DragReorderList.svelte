<script lang="ts" generics="T">
	import { GripVerticalIcon } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		items: T[];
		getLabel: (item: T) => string;
		row?: Snippet<[item: T, index: number]>;
		ondragend?: (items: T[]) => void;
		empty?: Snippet;
		class?: string;
	}

	let {
		items = $bindable(),
		getLabel,
		row,
		ondragend,
		empty,
		class: className = ''
	}: Props = $props();

	let listEl = $state<HTMLElement | null>(null);
	let isDragging = $state(false);
	let dragCurIndex = $state(-1);
	let ghostLabel = $state('');
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
		const itemEl = (e.currentTarget as HTMLElement).closest('[data-item]') as HTMLElement;
		const rect = itemEl.getBoundingClientRect();
		isDragging = true;
		dragCurIndex = idx;
		dragBaseIndex = idx;
		dragStartY = e.clientY;
		ghostLabel = getLabel(items[idx]);
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
			Math.min(items.length - 1, Math.round(dragBaseIndex + dy / estItemHeight))
		);
		if (targetIdx !== dragCurIndex) {
			const updated = [...items];
			const [moved] = updated.splice(dragCurIndex, 1);
			updated.splice(targetIdx, 0, moved);
			items = updated;
			dragCurIndex = targetIdx;
		}
		const listRect = listEl.getBoundingClientRect();
		stopAutoScroll();
		if (e.clientY < listRect.top + 60) {
			autoScrollId = setInterval(() => {
				listEl!.scrollTop -= 6;
			}, 16);
		} else if (e.clientY > listRect.bottom - 60) {
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
		ondragend?.(items);
	}

	function stopAutoScroll() {
		if (autoScrollId !== null) {
			clearInterval(autoScrollId);
			autoScrollId = null;
		}
	}
</script>

{#if isDragging}
	<div
		class="border-base-300 bg-base-100 pointer-events-none fixed z-50 flex items-center gap-3 border px-3 shadow-xl"
		style="top: {ghostTop}px; left: {ghostLeft}px; width: {ghostWidth}px; height: {ghostHeight}px;"
	>
		<GripVerticalIcon size={20} class="text-base-content/40 shrink-0" />
		<span class="grow">{ghostLabel}</span>
	</div>
{/if}

<section
	role="list"
	class="touch-pan-y {className}"
	bind:this={listEl}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
>
	{#if items.length === 0 && empty}
		{@render empty()}
	{:else}
		{#each items as item, i}
			<div
				role="listitem"
				data-item
				class="border-base-content/20 flex items-center gap-3 border-b px-3 py-2"
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
				{#if row}
					{@render row(item, i)}
				{:else}
					<span class="grow">{getLabel(item)}</span>
				{/if}
			</div>
		{/each}
	{/if}
</section>
