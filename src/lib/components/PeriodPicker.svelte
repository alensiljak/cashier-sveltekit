<!--
  PeriodPicker — compact "N + unit" duration picker.
  Usable inline inside cards, toolbars, or settings pages.
  Emits onchange after either field changes.
-->
<script lang="ts">
	export interface Period {
		n: number;
		unit: 'days' | 'weeks' | 'months' | 'years';
	}

	interface Props {
		value: Period;
		onchange?: () => void;
		disabled?: boolean;
		/** Override label; default "Period:" */
		label?: string;
	}

	let { value = $bindable(), onchange, disabled = false, label = 'Period:' }: Props = $props();

	const UNITS = ['days', 'weeks', 'months', 'years'] as const;

	function clamp(raw: number) {
		return Math.max(1, Math.min(120, Math.round(raw) || 1));
	}

	function handleNInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		value = { ...value, n: clamp(Number(input.value)) };
		onchange?.();
	}

	function handleUnitChange(e: Event) {
		const sel = e.currentTarget as HTMLSelectElement;
		value = { ...value, unit: sel.value as Period['unit'] };
		onchange?.();
	}
</script>

<div class="flex items-center gap-2">
	{#if label}
		<span class="text-sm text-base-content/60">{label}</span>
	{/if}
	<div class="join">
		<input
			type="number"
			min="1"
			max="120"
			value={value.n}
			oninput={handleNInput}
			class="join-item input input-sm input-bordered w-16 text-center"
			{disabled}
			aria-label="Period amount"
		/>
		<select
			value={value.unit}
			onchange={handleUnitChange}
			class="join-item select select-sm select-bordered"
			{disabled}
			aria-label="Period unit"
		>
			{#each UNITS as unit}
				<option value={unit}>{unit}</option>
			{/each}
		</select>
	</div>
</div>
