<!--
  YearSelector - dropdown for selecting a single calendar year (current or a
  previous one). Calls onselect with the resolved year on mount and on change.
  Mirrors MonthSelector's shape/interaction so the two are interchangeable at
  the call site.
-->
<script lang="ts">
	import moment from 'moment';
	import { ISODATEFORMAT } from '$lib/constants';
	import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/svelte';

	export interface YearOption {
		label: string;
		key: string;
		dateFrom: string;
		dateTo: string;
	}

	interface Props {
		onselect: (year: YearOption) => void;
		// how many years back from the current one to offer
		yearsBack?: number;
		// Year key ('YYYY') to preselect, e.g. restored from a session store.
		// Ignored if it doesn't match any offered year.
		initialKey?: string;
	}

	let { onselect, yearsBack = 5, initialKey }: Props = $props();

	function buildYears(): YearOption[] {
		const now = moment().startOf('year');
		const years: YearOption[] = [];
		for (let i = 0; i <= yearsBack; i++) {
			const yearStart = now.clone().subtract(i, 'years');
			years.push({
				label: i === 0 ? `${yearStart.format('YYYY')} (current)` : yearStart.format('YYYY'),
				key: yearStart.format('YYYY'),
				dateFrom: yearStart.clone().startOf('year').format(ISODATEFORMAT),
				dateTo: yearStart.clone().endOf('year').format(ISODATEFORMAT)
			});
		}
		return years;
	}

	const years = buildYears();
	// initialKey is only meant to seed the initial selection (e.g. restored
	// from a session store) — reading it here just once is intentional.
	// svelte-ignore state_referenced_locally
	let selectedKey = $state(years.some((y) => y.key === initialKey) ? initialKey! : years[0].key);

	// years[0] is the current (newest) year; higher index = further back.
	const selectedIndex = $derived(years.findIndex((y) => y.key === selectedKey));
	const canGoNewer = $derived(selectedIndex > 0);
	const canGoOlder = $derived(selectedIndex < years.length - 1);

	function currentYear(): YearOption {
		return years[selectedIndex] ?? years[0];
	}

	function goNewer() {
		if (canGoNewer) selectedKey = years[selectedIndex - 1].key;
	}

	function goOlder() {
		if (canGoOlder) selectedKey = years[selectedIndex + 1].key;
	}

	$effect(() => {
		// Notify parent whenever selection changes (and on first render)
		void selectedKey;
		onselect(currentYear());
	});
</script>

<div class="join">
	<button
		type="button"
		class="join-item btn btn-ghost btn-sm border border-base-content/20 px-2"
		disabled={!canGoOlder}
		aria-label="Previous year"
		onclick={goOlder}
	>
		<ChevronLeftIcon size={18} />
	</button>
	<select class="join-item select select-bordered select-sm w-52" bind:value={selectedKey}>
		{#each years as year}
			<option value={year.key}>{year.label}</option>
		{/each}
	</select>
	<button
		type="button"
		class="join-item btn btn-ghost btn-sm border border-base-content/20 px-2"
		disabled={!canGoNewer}
		aria-label="Next year"
		onclick={goNewer}
	>
		<ChevronRightIcon size={18} />
	</button>
</div>
