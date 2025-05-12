<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { PowerIcon, RefreshCcw } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import type { PageData } from './$types';
	import appService from '$lib/services/appService';
	import CashierDAL from '$lib/data/dal';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { beforeNavigate } from '$app/navigation';
	import { CashierSync } from '$lib/cashier-sync';

	Notifier.init();

	let { data }: { data: PageData } = $props();

	let serverUrl = $state('http://localhost:3000');
	let rootInvestmentAccount = '';
	let currency = '';
	let ptaSystem: string = '';

	let syncAccounts = $state(false);
	let syncAaValues = $state(false);
	let syncPayees = $state(false);
	let shutdownServer = $state(false);

	let rotationClass = $state('');

	onMount(async () => {
		// load sync settings
		await loadSettings();
	});

	beforeNavigate(async () => {
		if (shutdownServer) {
			// shutdown the server when leaving the page
			await onShutdownClick();
		}
	});

	async function loadSettings() {
		serverUrl = await settings.get(SettingKeys.syncServerUrl);
		rootInvestmentAccount = await settings.get(SettingKeys.rootInvestmentAccount);
		currency = await appService.getDefaultCurrency();
    	ptaSystem = await settings.get(SettingKeys.ptaSystem) as string


		syncAccounts = await settings.get(SettingKeys.syncAccounts);
		syncAaValues = await settings.get(SettingKeys.syncAaValues);
		syncPayees = await settings.get(SettingKeys.syncPayees);
	}

	/**
	 * shut the remote server down
	 */
	async function onShutdownClick() {
		const sync = new CashierSync(serverUrl, ptaSystem);
		try {
			await sync.shutdown();
		} catch (error: any) {
			console.error(error);
			Notifier.error(error.message);
		}

		Notifier.info('The server shutdown request sent.');
	}

	async function onSyncClicked() {
		rotationClass = rotationClass == '' ? 'animate-[spin_2s_linear_infinite]' : '';

		try {
			if (syncAccounts) {
				await synchronizeAccounts();
			}
			if (syncAaValues) {
				await synchronizeAaValues();
			}
			if (syncPayees) {
				await synchronizePayees();
			}
		} catch (error: any) {
			console.error(error);
			Notifier.error(error.message);
		}
		// stop spinning indicator.
		rotationClass = '';
	}

	async function saveSettings() {
		await settings.set(SettingKeys.syncAccounts, syncAccounts);
		await settings.set(SettingKeys.syncAaValues, syncAaValues);
		await settings.set(SettingKeys.syncPayees, syncPayees);
	}

	async function saveSyncServerUrl() {
		await settings.set(SettingKeys.syncServerUrl, serverUrl);

		Notifier.success('Server URL saved');
	}

	async function synchronizeAccounts() {
		const sync = new CashierSync(serverUrl, ptaSystem);

		const report = await sync.readAccounts();
		if (!report || report.length == 0) {
			Notifier.error('No accounts received: ' + report);
			return;
		}

		// delete all accounts only after we have retrieved the new ones.
		await appService.deleteAccounts();
		await appService.importBalanceSheet(report);

		Notifier.success('Accounts fetched from Ledger');
	}

	async function synchronizeAaValues() {
		const sync = new CashierSync(serverUrl, ptaSystem);

		try {
			await sync.readCurrentValues();

			Notifier.success('Asset Allocation values loaded');
		} catch (error: any) {
			console.error(error);
			Notifier.error(error.message);
		}
	}

	async function synchronizePayees() {
		const sync = new CashierSync(serverUrl, ptaSystem);

		const response = await sync.readPayees();

		if (!response || response.length == 0) {
			Notifier.error('Invalid response received: ' + response);
			return;
		}

		// delete all payees only after we have retrieved the new ones.
		const dal = new CashierDAL();
		await dal.deletePayees();

		await appService.importPayees(response);

		Notifier.success('Payees fetched from Ledger');
	}
</script>

<Toolbar title="Cashier Sync">
	{#snippet menuItems()}
		<ToolbarMenuItem text="Shut down server" Icon={PowerIcon} onclick={onShutdownClick} />
	{/snippet}
</Toolbar>

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

	<div>
		<label class="flex items-center space-x-2">
			<input
				class="checkbox"
				type="checkbox"
				bind:checked={shutdownServer}
				onchange={saveSettings}
			/>
			<p>Shut down Cashier Sync server when leaving the page.</p>
		</label>
	</div>
</main>
