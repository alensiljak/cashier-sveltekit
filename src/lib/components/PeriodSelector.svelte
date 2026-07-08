<!--
  PeriodSelector - dropdown for selecting a named time period.
  Calls onselect with the resolved date range on mount and on change.
-->
<script lang="ts">
	import moment from 'moment';
	import { ISODATEFORMAT } from '$lib/constants';
	import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/svelte';

	export interface Period {
		label: string;
		key: string;
		dateFrom: string;
		dateTo: string;
	}

	interface Props {
		onselect: (period: Period) => void;
	}

	let { onselect }: Props = $props();

	function buildPeriods(): Period[] {
		const now = moment();
		return [
			{
				label: 'This Month',
				key: 'this_month',
				dateFrom: now.clone().startOf('month').format(ISODATEFORMAT),
				dateTo: now.clone().endOf('month').format(ISODATEFORMAT)
			},
			{
				label: 'Last Month',
				key: 'last_month',
				dateFrom: now.clone().subtract(1, 'month').startOf('month').format(ISODATEFORMAT),
				dateTo: now.clone().subtract(1, 'month').endOf('month').format(ISODATEFORMAT)
			},
			{
				label: 'Last 3 Months',
				key: 'last_3_months',
				dateFrom: now.clone().subtract(3, 'months').startOf('month').format(ISODATEFORMAT),
				dateTo: now.clone().endOf('month').format(ISODATEFORMAT)
			},
			{
				label: 'Last 12 Months',
				key: 'last_12_months',
				dateFrom: now.clone().subtract(12, 'months').startOf('month').format(ISODATEFORMAT),
				dateTo: now.clone().endOf('month').format(ISODATEFORMAT)
			}
		];
	}

	const periods = buildPeriods();
	let selectedKey = $state(periods[0].key);

	// periods[0] is the newest/shortest period; higher index = further back.
	const selectedIndex = $derived(periods.findIndex((p) => p.key === selectedKey));
	const canGoNewer = $derived(selectedIndex > 0);
	const canGoOlder = $derived(selectedIndex < periods.length - 1);

	function currentPeriod(): Period {
		return periods[selectedIndex] ?? periods[0];
	}

	function goNewer() {
		if (canGoNewer) selectedKey = periods[selectedIndex - 1].key;
	}

	function goOlder() {
		if (canGoOlder) selectedKey = periods[selectedIndex + 1].key;
	}

	$effect(() => {
		// Notify parent whenever selection changes (and on first render)
		void selectedKey;
		onselect(currentPeriod());
	});
</script>

<div class="join">
	<button
		type="button"
		class="join-item btn btn-ghost btn-sm border border-base-content/20 px-2"
		disabled={!canGoOlder}
		aria-label="Previous period"
		onclick={goOlder}
	>
		<ChevronLeftIcon size={18} />
	</button>
	<select class="join-item select select-bordered select-sm" bind:value={selectedKey}>
		{#each periods as period}
			<option value={period.key}>{period.label}</option>
		{/each}
	</select>
	<button
		type="button"
		class="join-item btn btn-ghost btn-sm border border-base-content/20 px-2"
		disabled={!canGoNewer}
		aria-label="Next period"
		onclick={goNewer}
	>
		<ChevronRightIcon size={18} />
	</button>
</div>
