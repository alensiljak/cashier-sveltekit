<!--
  PeriodSelector - dropdown for selecting a named time period.
  Calls onselect with the resolved date range on mount and on change.
-->
<script lang="ts">
	import moment from 'moment';
	import { ISODATEFORMAT } from '$lib/constants';

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
			}
		];
	}

	const periods = buildPeriods();
	let selectedKey = $state(periods[0].key);

	function currentPeriod(): Period {
		return periods.find((p) => p.key === selectedKey) ?? periods[0];
	}

	$effect(() => {
		// Notify parent whenever selection changes (and on first render)
		void selectedKey;
		onselect(currentPeriod());
	});
</script>

<select class="select select-bordered select-sm" bind:value={selectedKey}>
	{#each periods as period}
		<option value={period.key}>{period.label}</option>
	{/each}
</select>
