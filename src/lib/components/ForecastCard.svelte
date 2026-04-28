<script lang="ts">
	import { ChartLineIcon, Settings2Icon } from '@lucide/svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
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

		_days = await settings.get(SettingKeys.forecastDays) as number;
		if (_days === 0) {
			_days = Constants.ForecastDays;
		}

		_settingsLoaded = true;
	}
</script>

<HomeCardTemplate>
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
</HomeCardTemplate>
