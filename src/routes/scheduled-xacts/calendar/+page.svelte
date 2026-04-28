<script lang="ts">
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import db from '$lib/data/db';
	import type { ScheduledTransaction } from '$lib/data/model';
	import appService from '$lib/services/appService';
	import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	let year = $state(today.getFullYear());
	let month = $state(today.getMonth()); // 0-indexed

	let allItems: ScheduledTransaction[] = $state([]);
	let selectedDate: string | null = $state(null);

	onMount(async () => {
		allItems = await db.scheduled.orderBy('nextDate').toArray();
	});

	function toIso(y: number, m: number, d: number): string {
		return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	}

	// Set of dates (ISO strings) that have scheduled transactions
	const markedDates = $derived(new Set(allItems.map((s) => s.nextDate.slice(0, 10))));

	const monthLabel = $derived(
		new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
	);

	// Calendar grid: array of { iso, day, currentMonth }
	const calendarDays = $derived(() => {
		const firstDay = new Date(year, month, 1);
		const lastDay = new Date(year, month + 1, 0);

		// Start on Monday (ISO week): 0=Mon..6=Sun
		const startDow = (firstDay.getDay() + 6) % 7;

		const days: { iso: string; day: number; currentMonth: boolean }[] = [];

		// Padding from previous month
		for (let i = startDow - 1; i >= 0; i--) {
			const d = new Date(year, month, -i);
			days.push({ iso: toIso(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), currentMonth: false });
		}

		// Current month
		for (let d = 1; d <= lastDay.getDate(); d++) {
			days.push({ iso: toIso(year, month, d), day: d, currentMonth: true });
		}

		// Trailing padding to complete last row
		const remaining = (7 - (days.length % 7)) % 7;
		for (let i = 1; i <= remaining; i++) {
			const d = new Date(year, month + 1, i);
			days.push({ iso: toIso(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), currentMonth: false });
		}

		return days;
	});

	const selectedItems = $derived(
		selectedDate ? allItems.filter((s) => s.nextDate.slice(0, 10) === selectedDate) : []
	);

	function prevMonth() {
		if (month === 0) {
			month = 11;
			year -= 1;
		} else {
			month -= 1;
		}
		selectedDate = null;
	}

	function nextMonth() {
		if (month === 11) {
			month = 0;
			year += 1;
		} else {
			month += 1;
		}
		selectedDate = null;
	}

	function selectDay(iso: string) {
		selectedDate = selectedDate === iso ? null : iso;
	}

	async function onItemClicked(id: number) {
		await appService.loadScheduledXact(id);
		await goto(`/scx-actions/${id}`);
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Calendar" />

	<!-- Month navigation -->
	<div class="flex items-center justify-between px-4 py-2">
		<button class="btn btn-ghost btn-sm" onclick={prevMonth}>
			<ChevronLeftIcon size={20} />
		</button>
		<span class="text-base font-semibold">{monthLabel}</span>
		<button class="btn btn-ghost btn-sm" onclick={nextMonth}>
			<ChevronRightIcon size={20} />
		</button>
	</div>

	<!-- Day-of-week headers -->
	<div class="grid grid-cols-7 text-center text-xs font-medium opacity-60 px-1">
		{#each ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as label}
			<div class="py-1">{label}</div>
		{/each}
	</div>

	<!-- Calendar grid -->
	<div class="grid grid-cols-7 px-1">
		{#each calendarDays() as cell}
			{@const isToday = cell.iso === toIso(today.getFullYear(), today.getMonth(), today.getDate())}
			{@const isSelected = cell.iso === selectedDate}
			{@const hasItems = markedDates.has(cell.iso)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="flex flex-col items-center py-1 cursor-pointer select-none"
				onclick={() => selectDay(cell.iso)}
			>
				<div
					class={[
						'flex h-8 w-8 items-center justify-center rounded-full text-sm',
						!cell.currentMonth && 'opacity-30',
						isSelected && 'bg-primary text-primary-content',
						isToday && !isSelected && 'ring-1 ring-primary',
					].filter(Boolean).join(' ')}
				>
					{cell.day}
				</div>
				<!-- dot marker -->
				<div class="h-1.5 w-1.5 rounded-full mt-0.5 {hasItems && cell.currentMonth ? 'bg-error' : 'invisible'}"></div>
			</div>
		{/each}
	</div>

	<!-- Selected-day transactions -->
	{#if selectedDate}
		<div class="border-base-content/15 mt-2 border-t px-2 pt-2">
			<p class="text-xs font-medium opacity-60 mb-1">{selectedDate}</p>
			{#if selectedItems.length === 0}
				<p class="text-sm opacity-50">No scheduled transactions</p>
			{:else}
				<div class="space-y-1">
					{#each selectedItems as scx (scx.id)}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="flex flex-row items-center rounded p-2 active:bg-base-200 cursor-pointer"
							onclick={() => onItemClicked(scx.id as number)}
						>
							<div class="grow">
								<div class="font-medium">{scx.transaction?.payee}</div>
								{#if scx.remarks}
									<div class="text-xs opacity-60">{scx.remarks.split('\n')[0]}</div>
								{/if}
							</div>
							{#if scx.amount}
								<div class="text-sm tabular-nums">
									{scx.amount.quantity}
									{scx.amount.currency}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</article>
