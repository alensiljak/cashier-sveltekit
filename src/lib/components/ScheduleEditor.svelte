<script lang="ts">
	import { ScheduledXact } from '$lib/data/mainStore';
	import { RecurrencePeriods } from '$lib/enums';
	import { onMount } from 'svelte';

	let _periods: string[] = $state([]);
	let recurrenceValue = $state('false');
	// let hasRecurrence: boolean = $state(false);
	let hasRecurrence = $derived(recurrenceValue === 'true' ? true : false);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		recurrenceValue =
			$ScheduledXact.count !== undefined && $ScheduledXact?.period !== undefined ? 'true' : 'false';

		// populate periods
		_periods = Object.values(RecurrencePeriods);
	}
</script>

<h3 class="h3 text-center">Schedule</h3>

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
		<div>
			{#if $ScheduledXact.count}
				<input type="number" class="input" bind:value={$ScheduledXact.count} />
			{/if}
			<select class="select">
				{#each _periods as period}
					<option value="period">{period}</option>
				{/each}
			</select>
		</div>
	{/if}
</div>

<!-- End -->
<div>
	<p>Ends:</p>

	<div class="space-y-2">
		<label class="flex items-center space-x-2">
			<input class="radio" type="radio" name="end" value="1" />
			<p>Never</p>
		</label>
		<label class="flex items-center space-x-2">
			<input class="radio" type="radio" name="end" value="2" />
			<p>On ...</p>
		</label>
	</div>

	{#if $ScheduledXact.endDate}
		<input type="date" class="input" bind:value={$ScheduledXact.endDate} />
	{/if}
</div>

<!-- Remarks -->
<div>
	<p>Remarks</p>
	<textarea class="textarea" bind:value={$ScheduledXact.remarks}></textarea>
</div>
