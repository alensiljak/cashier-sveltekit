<script lang="ts">
	import { ChartLineIcon, Settings2Icon } from '@lucide/svelte';
	import CashierCardTemplate from './CashierCardTemplate.svelte';
	import { Constants, SettingKeys, settings } from '$lib/settings';
	import { onMount } from 'svelte';
	import DailyForecastChart from './DailyForecastChart.svelte';

	let _accountNames: string[] = $state([]);
	let _days: number = $state(0);
	let _settingsLoaded = $state(false);

	onMount(() => {
		void loadData();
	});

	async function loadData() {
		let accountNames = await settings.get<string[]>(SettingKeys.forecastAccounts);
		if (!accountNames) {
			_settingsLoaded = true;
			return;
		}

		_accountNames = accountNames;

		// Never saved (null) or 0: use the default length.
		_days = ((await settings.get(SettingKeys.forecastDays)) as number | null) || Constants.ForecastDays;

		_settingsLoaded = true;
	}
</script>

<CashierCardTemplate>
	{#snippet icon()}
		<ChartLineIcon />
	{/snippet}
	{#snippet title()}
		Financial Forecast
	{/snippet}
	{#snippet menu()}
		<a href="/forecast-settings">
			<Settings2Icon  />
		</a>
	{/snippet}
	{#snippet content()}
		{#if !_settingsLoaded}
			<p>Loading forecast settings...</p>
		{:else if !_accountNames.length || !_days}
			<p>There are no accounts selected for forecasting</p>
		{:else}
			<DailyForecastChart daysCount={_days} accountNames={_accountNames} />
		{/if}
	{/snippet}
</CashierCardTemplate>
