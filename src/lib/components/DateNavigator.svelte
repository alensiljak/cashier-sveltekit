<!--
  DateNavigator - date input with < > buttons to step the date back/forth by one day.
  Styling matches the arrow buttons in YearPeriodSelector.
-->
<script lang="ts">
	import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/svelte';

	interface Props {
		value: string;
		onChange: () => void;
		label?: string;
		disabled?: boolean;
	}

	let { value = $bindable(), onChange, label = 'As of', disabled = false }: Props = $props();

	function shiftDate(days: number) {
		const date = new Date(`${value}T00:00:00`);
		date.setDate(date.getDate() + days);
		value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
		onChange();
	}
</script>

<div class="flex items-center gap-2 border-b border-base-300 px-4 py-2">
	{#if label}
		<label for="date-navigator-input" class="text-sm text-base-content/60">{label}</label>
	{/if}
	<div class="join">
		<button
			type="button"
			class="join-item btn btn-ghost btn-sm border border-base-content/20 px-2"
			{disabled}
			aria-label="Previous day"
			onclick={() => shiftDate(-1)}
		>
			<ChevronLeftIcon size={18} />
		</button>
		<input
			id="date-navigator-input"
			type="date"
			class="join-item input input-bordered input-sm"
			bind:value
			onchange={onChange}
			{disabled}
		/>
		<button
			type="button"
			class="join-item btn btn-ghost btn-sm border border-base-content/20 px-2"
			{disabled}
			aria-label="Next day"
			onclick={() => shiftDate(1)}
		>
			<ChevronRightIcon size={18} />
		</button>
	</div>
</div>
