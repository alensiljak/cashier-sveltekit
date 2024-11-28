<script>
	import { ChartLineIcon, SettingsIcon } from 'lucide-svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
</script>

<HomeCardTemplate>
	{#snippet icon()}
		<ChartLineIcon />
	{/snippet}
	{#snippet title()}
		Financial Forecast
	{/snippet}
	{#snippet menu()}
	<a href="/forecast-settings" >
		<SettingsIcon />
	</a>
	{/snippet}
	{#snippet content()}
	content
	{/snippet}
</HomeCardTemplate>
