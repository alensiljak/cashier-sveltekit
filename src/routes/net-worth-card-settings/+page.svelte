<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import PeriodPicker, { type Period } from '$lib/components/PeriodPicker.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import { CheckIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	const DEFAULT_PERIOD: Period = { n: 12, unit: 'months' };

	let period = $state<Period>({ ...DEFAULT_PERIOD });

	onMount(async () => {
		const saved = await settings.get<Period>(SettingKeys.netWorthPeriod);
		if (saved?.n && saved?.unit) period = saved;
	});

	async function onFabClicked() {
		await settings.set(SettingKeys.netWorthPeriod, period);
		history.back();
	}
</script>

<Toolbar title="Net Worth Card Settings" />

<Fab Icon={CheckIcon} onclick={onFabClicked} />

<main class="p-4 space-y-4">
	<h4 class="font-medium">Period</h4>
	<p class="text-sm text-base-content/60">
		How far back the chart looks. End-of-month snapshots are shown for the selected window.
	</p>
	<PeriodPicker bind:value={period} label="" />
</main>
