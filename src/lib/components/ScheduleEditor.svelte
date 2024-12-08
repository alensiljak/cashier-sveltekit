<script lang="ts">
	import { ScheduledXact } from '$lib/data/mainStore';
	import { ScheduledTransaction } from '$lib/data/model';
	import { RecurrencePeriods } from '$lib/enums';
	import { onMount } from 'svelte';

	let scx: ScheduledTransaction | undefined = $state(new ScheduledTransaction());
	let _periods: string[] = $state([]);
	let hasRecurrence: boolean = $derived(scx.count !== undefined && scx?.period !== undefined);
    let recurrenceSet: boolean = $state(false);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		scx = $ScheduledXact;

		// populate periods
		_periods = Object.values(RecurrencePeriods);
	}
</script>

<h3 class="h3 text-center">Schedule</h3>

<!-- Recurrence -->
<div>
	<p>Repeats:</p>

	<!-- radio group -->
	<div class="space-x-2 flex flex-row">
		<label class="flex items-center space-x-2">
			<input
				class="radio"
				type="radio"
				name="recurrence"
				value="false"
				bind:group={recurrenceSet}
			/>
			<p>Never</p>
		</label>
		<label class="flex items-center space-x-2">
			<input
				class="radio"
				type="radio"
				name="recurrence"
				value="true"
				bind:group={recurrenceSet}
			/>
			<p>Every ...</p>
		</label>
	</div>
	<input type="text" class="input" bind:value={recurrenceSet} />

	{#if recurrenceSet}
		<div>
			{#if scx?.count}
				<input type="number" class="input" bind:value={scx.count} />
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

	{#if scx?.endDate}
		<input type="date" class="input" bind:value={scx.endDate} />
	{/if}
</div>

<div>
	<p>Remarks</p>
	{#if scx?.remarks}
		<textarea class="textarea" bind:value={scx.remarks}></textarea>
	{/if}
</div>
