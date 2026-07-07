<!--
  MonthSelector - dropdown for selecting a single calendar month (current or a
  previous one). Calls onselect with the resolved month on mount and on change.
-->
<script lang="ts">
	import moment from 'moment';
	import { ISODATEFORMAT } from '$lib/constants';
	import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/svelte';

	export interface MonthOption {
		label: string;
		key: string;
		dateFrom: string;
		dateTo: string;
	}

	interface Props {
		onselect: (month: MonthOption) => void;
		// how many months back from the current one to offer
		monthsBack?: number;
		// Month key ('YYYY-MM') to preselect, e.g. restored from a session
		// store. Ignored if it doesn't match any offered month.
		initialKey?: string;
	}

	let { onselect, monthsBack = 12, initialKey }: Props = $props();

	function buildMonths(): MonthOption[] {
		const now = moment().startOf('month');
		const months: MonthOption[] = [];
		for (let i = 0; i <= monthsBack; i++) {
			const monthStart = now.clone().subtract(i, 'months');
			months.push({
				label: i === 0 ? `${monthStart.format('MMMM YYYY')} (current)` : monthStart.format('MMMM YYYY'),
				key: monthStart.format('YYYY-MM'),
				dateFrom: monthStart.clone().startOf('month').format(ISODATEFORMAT),
				dateTo: monthStart.clone().endOf('month').format(ISODATEFORMAT)
			});
		}
		return months;
	}

	const months = buildMonths();
	// initialKey is only meant to seed the initial selection (e.g. restored
	// from a session store) — reading it here just once is intentional.
	// svelte-ignore state_referenced_locally
	let selectedKey = $state(months.some((m) => m.key === initialKey) ? initialKey! : months[0].key);

	// months[0] is the current (newest) month; higher index = further back.
	const selectedIndex = $derived(months.findIndex((m) => m.key === selectedKey));
	const canGoNewer = $derived(selectedIndex > 0);
	const canGoOlder = $derived(selectedIndex < months.length - 1);

	function currentMonth(): MonthOption {
		return months[selectedIndex] ?? months[0];
	}

	function goNewer() {
		if (canGoNewer) selectedKey = months[selectedIndex - 1].key;
	}

	function goOlder() {
		if (canGoOlder) selectedKey = months[selectedIndex + 1].key;
	}

	$effect(() => {
		// Notify parent whenever selection changes (and on first render)
		void selectedKey;
		onselect(currentMonth());
	});
</script>

<div class="join">
	<button
		type="button"
		class="join-item btn btn-ghost btn-sm border border-base-content/20 px-2"
		disabled={!canGoOlder}
		aria-label="Previous month"
		onclick={goOlder}
	>
		<ChevronLeftIcon size={18} />
	</button>
	<select class="join-item select select-bordered select-sm w-52" bind:value={selectedKey}>
		{#each months as month}
			<option value={month.key}>{month.label}</option>
		{/each}
	</select>
	<button
		type="button"
		class="join-item btn btn-ghost btn-sm border border-base-content/20 px-2"
		disabled={!canGoNewer}
		aria-label="Next month"
		onclick={goNewer}
	>
		<ChevronRightIcon size={18} />
	</button>
</div>
