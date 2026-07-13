<!--
  YearPeriodSelector - dropdown for selecting "Last 12 months" or specific years.
  Similar to the period selector used in income vs expense report.
-->
<script lang="ts">
	import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/svelte';

	interface Props {
		selectedPeriod: string;
		onChange: () => void;
		disabled?: boolean;
		/** Adds an "All" option (broadest, oldest end of the range) for since-inception reports. */
		includeAll?: boolean;
	}

	let {
		selectedPeriod = $bindable(),
		onChange,
		disabled = false,
		includeAll = false
	}: Props = $props();

	const currentYear = new Date().getFullYear();
	const availableYears = Array.from({ length: 10 }, (_, i) => currentYear - i);
	// periods[0] is "last12" (newest); "all" (oldest/broadest), when enabled, goes last.
	const periods = $derived([
		'last12',
		...availableYears.map(String),
		...(includeAll ? ['all'] : [])
	]);

	const selectedIndex = $derived.by(() => {
		const idx = periods.indexOf(selectedPeriod);
		return idx === -1 ? 0 : idx;
	});
	const canGoNewer = $derived(selectedIndex > 0);
	const canGoOlder = $derived(selectedIndex < periods.length - 1);

	function goNewer() {
		if (canGoNewer) {
			selectedPeriod = periods[selectedIndex - 1];
			onChange();
		}
	}

	function goOlder() {
		if (canGoOlder) {
			selectedPeriod = periods[selectedIndex + 1];
			onChange();
		}
	}
</script>

<div class="border-b border-base-300 px-4 py-2">
	<div class="flex items-center gap-3">
		<span class="text-sm font-medium text-base-content/60">Period:</span>
		<div class="join">
			<button
				type="button"
				class="join-item btn btn-ghost btn-sm border border-base-content/20 px-2"
				disabled={!canGoOlder || disabled}
				aria-label="Previous year"
				onclick={goOlder}
			>
				<ChevronLeftIcon size={18} />
			</button>
			<select
				class="join-item select select-bordered select-sm"
				bind:value={selectedPeriod}
				onchange={onChange}
				{disabled}
			>
				<option value="last12">Last 12 months</option>
				{#each availableYears as year}
					<option value={String(year)}>{year}</option>
				{/each}
				{#if includeAll}
					<option value="all">All</option>
				{/if}
			</select>
			<button
				type="button"
				class="join-item btn btn-ghost btn-sm border border-base-content/20 px-2"
				disabled={!canGoNewer || disabled}
				aria-label="Next year"
				onclick={goNewer}
			>
				<ChevronRightIcon size={18} />
			</button>
		</div>
	</div>
</div>
