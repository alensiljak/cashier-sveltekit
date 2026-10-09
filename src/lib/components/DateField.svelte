<script lang="ts">
	import { onMount } from 'svelte';
	import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from '@lucide/svelte';
	import moment from 'moment';
	import { SettingKeys, settings } from '#lib/settings';

	type Props = {
		/** Bindable ISO date (YYYY-MM-DD). */
		value: string | undefined;
		label?: string;
	};
	let { value = $bindable(), label = 'Date' }: Props = $props();

	const DATE_FORMAT_DEFAULT = 'D MMM YYYY';
	let dateFormatValue = $state(DATE_FORMAT_DEFAULT);
	let dateInputEl: HTMLInputElement | undefined;

	let formattedDate = $derived.by(() => {
		if (!value) return label;
		return moment(value).format(dateFormatValue);
	});

	function shiftDate(days: number) {
		if (!value) return;
		const d = new Date(value);
		d.setDate(d.getDate() + days);
		value = d.toISOString().slice(0, 10);
	}

	onMount(async () => {
		const fmt = await settings.get<string>(SettingKeys.dateFormat);
		if (fmt) dateFormatValue = fmt;
	});
</script>

<div class="flex items-center">
	<CalendarIcon class="h-5 w-5 mr-2 opacity-70" />
	<button type="button" class="btn btn-ghost h-11 w-11 p-0" onclick={() => shiftDate(-1)}
		><ChevronLeftIcon class="h-4 w-4" /></button
	>
	<div class="relative flex-1">
		<button
			type="button"
			class="field-material flex items-center cursor-pointer px-1 pt-4 pb-1 w-full text-left"
			onclick={() => dateInputEl?.showPicker?.()}
		>
			{formattedDate}
		</button>
		<span class="field-label" class:field-label-floated={!!value}>{label}</span>
		<input bind:this={dateInputEl} title={label} type="date" class="sr-only" bind:value />
	</div>
	<button type="button" class="btn btn-ghost h-11 w-11 p-0" onclick={() => shiftDate(1)}
		><ChevronRightIcon class="h-4 w-4" /></button
	>
</div>
