<!--
  YearPeriodSelector - dropdown for selecting "Last 12 months" or specific years.
  Similar to the period selector used in income vs expense report.
-->
<script lang="ts">
	interface Props {
		selectedPeriod: string;
		onChange: () => void;
		disabled?: boolean;
	}

	export let selectedPeriod: string;
	export let onChange: () => void;
	export let disabled = false;

	const currentYear = new Date().getFullYear();
	const availableYears = Array.from({ length: 10 }, (_, i) => currentYear - i);
</script>

<div class="flex items-center gap-3 border-b border-base-300 px-4 py-2">
	<span class="text-sm font-medium text-base-content/60">Period:</span>
	<select
		class="select select-bordered select-sm"
		bind:value={selectedPeriod}
		onchange={onChange}
		disabled={disabled}
	>
		<option value="last12">Last 12 months</option>
		{#each availableYears as year}
			<option value={String(year)}>{year}</option>
		{/each}
	</select>
</div>