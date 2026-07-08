<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { DEFAULT_EXPENSES_CARD_ROLLING_DAYS } from '$lib/constants';
	import { SettingKeys, settings } from '$lib/settings';
	import { CheckIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	type PeriodType = 'calendar-month' | 'rolling-days';

	let periodType = $state<PeriodType>('calendar-month');
	let rollingDays = $state(DEFAULT_EXPENSES_CARD_ROLLING_DAYS as number);

	onMount(async () => {
		periodType = (await settings.get<PeriodType>(SettingKeys.expensesCardPeriodType)) ?? 'calendar-month';
		rollingDays =
			(await settings.get<number>(SettingKeys.expensesCardRollingDays)) ?? DEFAULT_EXPENSES_CARD_ROLLING_DAYS;
	});

	async function onFabClicked() {
		await settings.set(SettingKeys.expensesCardPeriodType, periodType);
		await settings.set(SettingKeys.expensesCardRollingDays, rollingDays);

		history.back();
	}
</script>

<Toolbar title="Expenses Card Settings" />

<Fab Icon={CheckIcon} onclick={onFabClicked} />

<main class="p-1">
	<h4 class="h4">Period</h4>

	<div class="flex flex-col gap-2 py-2">
		<label class="flex items-center space-x-2">
			<input
				class="radio radio-primary"
				type="radio"
				name="periodType"
				value="calendar-month"
				bind:group={periodType}
			/>
			<p>Current calendar month</p>
		</label>

		<label class="flex items-center space-x-2">
			<input
				class="radio radio-primary"
				type="radio"
				name="periodType"
				value="rolling-days"
				bind:group={periodType}
			/>
			<p>Rolling last N days</p>
		</label>
	</div>

	{#if periodType === 'rolling-days'}
		<h4 class="h4">Number of days</h4>
		<input type="number" min="1" class="input text-right" bind:value={rollingDays} />
	{/if}

	<p class="pt-4 text-sm opacity-60">
		Top categories and totals exclude the same accounts hidden in the Expenses report filter.
	</p>
</main>
