<!--
  TimeRangeSelector - time-slice picker built from plain units, not "this/last" pairs.
  Each chip picks a SHAPE (calendar month/year, or a rolling N-month trailing span); an
  absolute ANCHOR date (defaulting to today) says where the window sits. Arrows/the jump
  list move the anchor by exactly one unit of the active shape — 1 month for
  calendar-month and rolling presets, 1 year for calendar-year — so "last month" is just
  "Month" + one arrow back, not a separate preset. Rolling presets slide by 1 month (a
  scrub), not by their full span, so trend charts move smoothly rather than page-jumping.

  The anchor is absolute (an ISO date), not "N steps back from today", for two reasons:
  switching chips keeps you looking at the same period instead of snapping back to
  "today" in the new shape (picking April, then 3 Mo, should show the quarter containing
  April — not today's quarter), and a caller can link to an explicit period (e.g.
  "2025-11") that stays correct regardless of when the link is opened, rather than an
  offset that silently points somewhere else once "today" has moved on.
-->
<script lang="ts">
	import {
		add,
		diffMonths,
		diffYears,
		endOfMonth,
		endOfYear,
		formatDate,
		isSameUnit,
		parseDate,
		startOfMonth,
		startOfYear
	} from '#lib/utils/dates';
	import { untrack } from 'svelte';
	import { ISODATEFORMAT } from '#lib/constants';
	import { ChevronLeftIcon, ChevronRightIcon, RotateCcwIcon } from '@lucide/svelte';

	export interface TimeRange {
		label: string;
		dateFrom: string;
		dateTo: string;
	}

	type Shape = 'calendar-month' | 'calendar-year' | 'rolling';

	interface Preset {
		key: string;
		chipLabel: string;
		shape: Shape;
		/** Span in months (1 for calendar-month, 12 for calendar-year and default rolling) */
		months: number;
	}

	const PRESETS: Preset[] = [
		{ key: 'month', chipLabel: 'Month', shape: 'calendar-month', months: 1 },
		{ key: 'rolling_3', chipLabel: '3 Mo', shape: 'rolling', months: 3 },
		{ key: 'rolling_12', chipLabel: '12 Mo', shape: 'rolling', months: 12 },
		{ key: 'year', chipLabel: 'Year', shape: 'calendar-year', months: 12 },
		{ key: 'custom', chipLabel: 'Custom', shape: 'rolling', months: 0 }
	];

	export interface TimeRangeState {
		chip: string;
		/** ISO date identifying the selected period (any date within it — e.g. any day of
		 * the target month/year). Absolute, not relative to "today". */
		anchor: string;
	}

	interface Props {
		/** state is (chip, anchor) as currently selected — a caller can persist it (e.g. to
		 * the URL) and hand it back via `initial`/`initialAnchor` to restore this exact
		 * selection later, distinct from the component's own hardcoded default. */
		onselect: (range: TimeRange, state: TimeRangeState) => void;
		/** Chip key to select initially (defaults to "month") */
		initial?: string;
		/** Anchor date to select initially (defaults to today); only meaningful alongside `initial` */
		initialAnchor?: string;
		/** Seed values for the Custom date inputs (e.g. a deep-linked range); only used when initial="custom" */
		initialCustomFrom?: string;
		initialCustomTo?: string;
	}

	let {
		onselect,
		initial = 'month',
		initialAnchor,
		initialCustomFrom,
		initialCustomTo
	}: Props = $props();

	const today = () => formatDate(new Date(), ISODATEFORMAT);

	// Props are seeds for one-time initialization only (see `initial`/`initialAnchor` docs
	// above), not meant to stay in sync with the parent — untrack silences Svelte's
	// state_referenced_locally warning, which would otherwise suggest the opposite.
	let selectedChip = $state(untrack(() => initial));
	let anchor = $state(untrack(() => initialAnchor ?? today())); // the period currently shown, as an absolute date
	let customFrom = $state(
		untrack(() => initialCustomFrom ?? formatDate(startOfMonth(new Date()), ISODATEFORMAT))
	);
	let customTo = $state(
		untrack(() => initialCustomTo ?? formatDate(endOfMonth(new Date()), ISODATEFORMAT))
	);

	const isCustom = $derived(selectedChip === 'custom');
	const activePreset = $derived(PRESETS.find((p) => p.key === selectedChip) ?? PRESETS[0]);
	const unit = $derived(activePreset.shape === 'calendar-year' ? 'year' : 'month');

	// "Later" is disabled, and stepping/jumping forward is clamped, once the anchor is
	// already in the same unit as today — periods can't run into the future.
	const isAtNewest = $derived(isSameUnit(parseDate(anchor), new Date(), unit));

	function selectChip(key: string) {
		// Deliberately keep `anchor` as-is: switching shape should re-frame the SAME period
		// (e.g. April -> the quarter containing April), not reset to today.
		selectedChip = key;
	}

	function step(delta: number) {
		if (isCustom) return;
		if (delta > 0 && isAtNewest) return;
		anchor = formatDate(add(parseDate(anchor), delta, unit), ISODATEFORMAT);
	}

	function resetToToday() {
		if (isCustom) return;
		anchor = today();
	}

	function resolveAt(a: string): TimeRange {
		const preset = activePreset;
		const m = parseDate(a);

		if (preset.shape === 'calendar-month') {
			return {
				label: formatDate(m, 'MMM YYYY'),
				dateFrom: formatDate(startOfMonth(m), ISODATEFORMAT),
				dateTo: formatDate(endOfMonth(m), ISODATEFORMAT)
			};
		}

		if (preset.shape === 'calendar-year') {
			return {
				label: formatDate(m, 'YYYY'),
				dateFrom: formatDate(startOfYear(m), ISODATEFORMAT),
				dateTo: formatDate(endOfYear(m), ISODATEFORMAT)
			};
		}

		// Rolling: trailing `months`-month window ending in the anchor's month.
		const end = endOfMonth(m);
		const start = startOfMonth(add(end, -(preset.months - 1), 'month'));
		return {
			label: `${formatDate(start, 'MMM YYYY')} – ${formatDate(end, 'MMM YYYY')}`,
			dateFrom: formatDate(start, ISODATEFORMAT),
			dateTo: formatDate(end, ISODATEFORMAT)
		};
	}

	function resolve(): TimeRange {
		if (isCustom) {
			return { label: 'Custom', dateFrom: customFrom, dateTo: customTo };
		}
		return resolveAt(anchor);
	}

	// Jump list: a window of anchors centered on the current one, stepping by the active
	// shape's unit, clamped so it never lists a future period — picking one re-centers the
	// list around the new anchor next time it's opened.
	const JUMP_WINDOW = 6;
	const jumpAnchors = $derived.by(() => {
		if (isCustom) return [];
		const base = parseDate(anchor);
		const unitsToToday = (unit === 'year' ? diffYears : diffMonths)(new Date(), base);
		const forwardCount = Math.min(JUMP_WINDOW, unitsToToday);
		return Array.from({ length: JUMP_WINDOW + forwardCount + 1 }, (_, i) =>
			formatDate(add(base, i - JUMP_WINDOW, unit), ISODATEFORMAT)
		);
	});

	function applyCustom() {
		if (isCustom) onselect(resolve(), { chip: selectedChip, anchor });
	}

	$effect(() => {
		// Notify parent whenever the resolved window changes (and on first render).
		// Custom notifies immediately too (with its current defaults), then again via applyCustom.
		void selectedChip;
		void anchor;
		onselect(resolve(), { chip: selectedChip, anchor });
	});
</script>

<div class="flex flex-col gap-2">
	<div class="flex flex-wrap gap-1">
		{#each PRESETS as preset}
			<button
				type="button"
				class="btn btn-xs"
				class:btn-primary={selectedChip === preset.key}
				class:btn-ghost={selectedChip !== preset.key}
				onclick={() => selectChip(preset.key)}
			>
				{preset.chipLabel}
			</button>
		{/each}
	</div>

	{#if isCustom}
		<div class="flex items-center gap-2">
			<input type="date" class="input input-bordered input-sm" bind:value={customFrom} onchange={applyCustom} />
			<span class="text-base-content/50">to</span>
			<input type="date" class="input input-bordered input-sm" bind:value={customTo} onchange={applyCustom} />
		</div>
	{:else}
		<div class="flex items-center gap-1">
			<div class="join">
				<button
					type="button"
					class="join-item btn btn-ghost btn-sm border border-base-content/20 px-2"
					aria-label="Earlier"
					onclick={() => step(-1)}
				>
					<ChevronLeftIcon size={18} />
				</button>
				<select
					class="join-item select select-bordered select-sm"
					value={anchor}
					onchange={(e) => (anchor = e.currentTarget.value)}
				>
					<!-- Windowed around the current anchor (see jumpAnchors) rather than every
					     unit back to the epoch, so jumping far back doesn't mean a huge list. -->
					{#each jumpAnchors as a}
						<option value={a}>{resolveAt(a).label}</option>
					{/each}
				</select>
				<button
					type="button"
					class="join-item btn btn-ghost btn-sm border border-base-content/20 px-2"
					disabled={isAtNewest}
					aria-label="Later"
					onclick={() => step(1)}
				>
					<ChevronRightIcon size={18} />
				</button>
			</div>
			{#if !isAtNewest}
				<button
					type="button"
					class="btn btn-ghost btn-sm btn-square"
					aria-label="Reset to today"
					title="Reset to today"
					onclick={resetToToday}
				>
					<RotateCcwIcon size={16} />
				</button>
			{/if}
		</div>
	{/if}
</div>
