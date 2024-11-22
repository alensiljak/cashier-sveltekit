<script lang="ts">
	import Toolbar from '$lib/components/toolbar.svelte';
	import { RefreshCcw } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';

	Notifier.init();

	let serverUrl = 'http://localhost:3000';
	let rootInvestmentAccount = null;
	let currency = null;

	let syncAccounts = false;
	let syncAaValues = false;
	let syncPayees = false;

	let rotationClass = '';

	onMount(async () => {
		// load sync settings
		await loadSettings();
	});

	async function loadSettings() {
		serverUrl = await settings.get(SettingKeys.syncServerUrl);
		rootInvestmentAccount = await settings.get(SettingKeys.rootInvestmentAccount);
		currency = await settings.get(SettingKeys.currency);

		syncAccounts = await settings.get(SettingKeys.syncAccounts);
		syncAaValues = await settings.get(SettingKeys.syncAaValues);
		syncPayees = await settings.get(SettingKeys.syncPayees);
	}

	function onSyncClicked() {
		rotationClass = rotationClass == '' ? 'animate-[spin_2s_linear_infinite]' : '';

		if (rotationClass !== '') {
			Notifier.notify('not implemented', 'bg-info-500');
		}
	}

	async function saveSettings() {
		await settings.set(SettingKeys.syncAccounts, syncAccounts);
		await settings.set(SettingKeys.syncAaValues, syncAaValues);
		await settings.set(SettingKeys.syncPayees, syncPayees);
	}

	async function saveSyncServerUrl() {
		await settings.set(SettingKeys.syncServerUrl, serverUrl);

		Notifier.notify('Server URL saved', 'bg-success-500');
	}
</script>

<Toolbar title="Cashier Sync" />

<main class="container space-y-4 p-1 lg:p-10">
	<p>To update data from Ledger, the Cashier Server must be running and accessible.</p>
	<p>You can run the Cashier Server locally.</p>

	<label class="label">
		<span>Server URL</span>
		<input
			class="input"
			type="text"
			placeholder="Server URL"
			bind:value={serverUrl}
			onchange={saveSyncServerUrl}
		/>
	</label>

	<center>
		<h3 class="h3">Synchronize</h3>
	</center>

	<div class="flex flex-col space-y-8 pt-6">
		<label class="flex items-center space-x-2">
			<input class="checkbox" type="checkbox" bind:checked={syncAccounts} onchange={saveSettings} />
			<p>Sync account list with balances</p>
		</label>
		<label class="flex items-center space-x-2">
			<input class="checkbox" type="checkbox" bind:checked={syncAaValues} onchange={saveSettings} />
			<p>Sync account balances in base currency, for asset allocation.</p>
		</label>
		<label class="flex items-center space-x-2">
			<input class="checkbox" type="checkbox" bind:checked={syncPayees} onchange={saveSettings} />
			<p>Sync Payees</p>
		</label>
	</div>

	<center class="pt-10">
		<button class="btn bg-tertiary-500 uppercase text-secondary-500" onclick={onSyncClicked}>
			<span><RefreshCcw class={rotationClass} style="animation-direction: reverse;" /></span>
			<span>Sync</span>
		</button>
	</center>
</main>
