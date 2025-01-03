<script lang="ts">
	import { ChartLineIcon, SettingsIcon } from 'lucide-svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { Constants, SettingKeys, settings } from '$lib/settings';
	import { onMount } from 'svelte';
	import DailyForecastChart from './DailyForecastChart.svelte';

	let _accountNames: string[] = $state([]);
	let _days: number = $state(0);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		let accountNames = await settings.get(SettingKeys.forecastAccounts);
		if (!accountNames) return;

		_accountNames = accountNames;

		_days = await settings.get(SettingKeys.forecastDays);
		if (_days === 0) {
			_days = Constants.ForecastDays;
		}
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
			<SettingsIcon />
		</a>
	{/snippet}
	{#snippet content()}
		{#if !_accountNames.length || !_days}
			<p>There are no accounts selected for forecasting</p>
		{:else}
			<DailyForecastChart daysCount={_days} accountNames={_accountNames} />
		{/if}
	{/snippet}
</HomeCardTemplate>
