<script lang="ts">
	import { goto } from '$app/navigation';
	import { ScheduledXact } from '$lib/data/mainStore';
	import { RecurrencePeriods } from '$lib/enums';
	import Notifier from '$lib/utils/notifier';
	import { onMount } from 'svelte';

	Notifier.init();

	let _periods: string[] = $state([]);
	let recurrenceValue = $state('false');
	let hasRecurrence = $derived(recurrenceValue === 'true' ? true : false);
	let endDateValue = $state('false');
	let hasEndDate = $derived(endDateValue === 'true' ? true : false);

	onMount(async () => {
		if (!$ScheduledXact) {
			Notifier.info('No Scheduled Transaction found!');
			goto('/scheduled-xacts');
		}
		await loadData();
	});

	async function handleRecurrenceChange() {
		// we should get here only when Never is selected.
		if (recurrenceValue !== 'false') return;

		$ScheduledXact.count = undefined;
		$ScheduledXact.period = undefined;
	}

	async function loadData() {
		// populate periods
		_periods = Object.values(RecurrencePeriods);

		recurrenceValue =
			$ScheduledXact.count !== undefined && $ScheduledXact?.period !== undefined ? 'true' : 'false';

		endDateValue = $ScheduledXact.endDate ? 'true' : 'false';
	}

	async function onEndDateChanged() {
		if (endDateValue !== 'false') return;

		$ScheduledXact.endDate = undefined;
	}
</script>

<h3 class="h3 text-center">Schedule</h3>

<!-- Repayment -->
<div class="flex flex-row items-center justify-between">
	<div>
		<p>Repayment</p>
		<p class="text-sm opacity-60">Amount is auto-calculated from the Liabilities account balance</p>
	</div>
	<input
		class="toggle toggle-success bg-transparent bg-none"
		type="checkbox"
		bind:checked={$ScheduledXact.repayment}
	/>
</div>

<!-- Recurrence -->
<div>
	<p>Repeats:</p>

	<!-- radio group -->
	<div class="flex flex-row space-x-2">
		<label class="flex items-center space-x-2">
			<input
				class="radio"
				type="radio"
				name="recurrence"
				value="false"
				bind:group={recurrenceValue}
				onchange={handleRecurrenceChange}
			/>
			<p>Never</p>
		</label>
		<label class="flex items-center space-x-2">
			<input
				class="radio"
				type="radio"
				name="recurrence"
				value="true"
				bind:group={recurrenceValue}
			/>
			<p>Every ...</p>
		</label>
	</div>
	{#if hasRecurrence}
		<div class="flex flex-row gap-2">
			<input
				type="number"
				class="field-material w-16 px-1 py-2 text-center"
				bind:value={$ScheduledXact.count}
			/>
			<select class="field-material grow px-1 py-2" bind:value={$ScheduledXact.period}>
				{#each _periods as period (period)}
					<option value={period}>{period}</option>
				{/each}
			</select>
		</div>
	{/if}
</div>

<!-- End -->
<div>
	<p>Ends:</p>

	<div class="flex flex-row space-x-2">
		<label class="flex items-center space-x-2">
			<input
				class="radio"
				type="radio"
				name="end"
				value="false"
				bind:group={endDateValue}
				onchange={onEndDateChanged}
			/>
			<p>Never</p>
		</label>
		<label class="flex items-center space-x-2">
			<input class="radio" type="radio" name="end" value="true" bind:group={endDateValue} />
			<p>On ...</p>
		</label>
	</div>
	{#if hasEndDate}
		<input type="date" class="field-material px-1 py-2" bind:value={$ScheduledXact.endDate} />
	{/if}
</div>

<!-- Remarks -->
<div class="relative mb-10">
	<textarea
		class="field-material peer w-full px-1 pt-5 pb-1"
		placeholder=" "
		bind:value={$ScheduledXact.remarks}
		rows="5"
	></textarea>
	<span class="field-label">Remarks</span>
</div>
