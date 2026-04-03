<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { PowerIcon, RefreshCcw } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import * as CashierSync from '$lib/sync/sync-beancount';
	import { InfrastructureFiles } from '$lib/constants';
	import {
		syncAccounts as doSyncAccounts,
		syncCurrentValues as doSyncCurrentValues,
		syncPayees as doSyncPayees,
		syncInfrastructureFiles as doSyncInfrastructureFiles
	} from '$lib/sync/sync-common';
	import { goto } from '$app/navigation';
	import * as cashierFsSync from '$lib/sync/sync-fs';

	Notifier.init();

	let syncAccounts = $state(false);
	let syncAaValues = $state(false);
	let syncPayees = $state(false);
	let syncInfrastructureFiles = $state(false);

	let rotationClass = $state('');

	type ConfigSource = 'filesystem' | 'rledger' | 'beancount' | 'ledger';
	let configSource = $state<ConfigSource>('filesystem');

	let serverUrl = $state('');
	let _ptaSystem = $state('');

	onMount(async () => {
		await loadSettings();
	});

	async function loadSettings() {
		serverUrl = ((await settings.get<string>(SettingKeys.syncServerUrl)) as string | null) ?? '';
		_ptaSystem = ((await settings.get(SettingKeys.ptaSystem)) as string) ?? '';
		if (_ptaSystem) configSource = _ptaSystem as ConfigSource;

		syncAccounts = (await settings.get(SettingKeys.syncAccounts)) ?? false;
		syncAaValues = (await settings.get(SettingKeys.syncAaValues)) ?? false;
		syncPayees = (await settings.get(SettingKeys.syncPayees)) ?? false;
		syncInfrastructureFiles = (await settings.get(SettingKeys.syncInfrastructureFiles)) ?? false;
	}

	async function onConfigSourceChanged() {
		_ptaSystem = configSource;
		await settings.set(SettingKeys.ptaSystem, configSource);
	}

	function onConfigureClick() {
		switch (configSource) {
			case 'filesystem':
				goto('/sync/filesystem');
				break;
			case 'beancount':
				goto('/sync/beancount');
				break;
			case 'rledger':
				Notifier.warning('Configure Cashier Server (Rust Ledger) - Not implemented yet.');
				break;
			case 'ledger':
				Notifier.warning('Configure Cashier Server (Ledger-cli) - Not implemented yet.');
				break;
		}
	}

	function getActiveServerUrlOrNotify() {
		const url = serverUrl?.trim();

		if (!url) {
			Notifier.error('No sync server configured. Please configure a sync server first.');
			return null;
		}

		return url;
	}

	async function reloadData() {
		const activeUrl = getActiveServerUrlOrNotify();
		if (!activeUrl) return;

		const sync = new CashierSync(activeUrl, _ptaSystem);
		await sync.reloadData();
	}

	async function onShutdownClick() {
		const activeUrl = getActiveServerUrlOrNotify();
		if (!activeUrl) return;

		const sync = new CashierSync(activeUrl, _ptaSystem);
		try {
			await sync.shutdown();
		} catch (error: any) {
			console.error(error);
			Notifier.error(error.message);
		}

		Notifier.info('The server shutdown request sent.');
	}

	async function onSyncClicked() {
		Notifier.info('Synchronization starting...');

		rotationClass = rotationClass == '' ? 'animate-[spin_2s_linear_infinite]' : '';

		try {
			// check which backend to synchronize with.
			switch (configSource) {
				case 'filesystem':
					await cashierFsSync.synchronize();
					break;
				case 'beancount':
					await CashierSync.synchronize();
					break;
				case 'rledger':
					Notifier.warning(
						'Synchronization with Cashier Server (Rust Ledger) not implemented yet.'
					);
					break;
				case 'ledger':
					Notifier.warning('Synchronization with Cashier Server (Ledger-cli) not implemented yet.');
					break;
			}
		} catch (error: any) {
			console.error(error);
			Notifier.error(error.message);
		}

		rotationClass = '';

		Notifier.success('Synchronization completed successfully!');
	}

	async function saveSettings() {
		await settings.set(SettingKeys.syncAccounts, syncAccounts);
		await settings.set(SettingKeys.syncAaValues, syncAaValues);
		await settings.set(SettingKeys.syncPayees, syncPayees);
		await settings.set(SettingKeys.syncInfrastructureFiles, syncInfrastructureFiles);
	}

	async function synchronizeAccounts(activeUrl: string) {
		const sync = new CashierSync(activeUrl, _ptaSystem);
		const response = await sync.readAccounts(_ptaSystem);
		await doSyncAccounts(_ptaSystem, response);
		Notifier.success('Accounts fetched from Ledger');
	}

	async function synchronizeAaValues(activeUrl: string) {
		const sync = new CashierSync(activeUrl, _ptaSystem);
		const result = await sync.readCurrentValues();
		await doSyncCurrentValues(_ptaSystem, result);
		Notifier.success('Asset Allocation values loaded');
	}

	async function synchronizePayees(activeUrl: string) {
		const sync = new CashierSync(activeUrl, _ptaSystem);
		const response = await sync.readPayees();
		await doSyncPayees(response);
		Notifier.success('Payees fetched from Ledger');
	}

	async function synchronizeInfrastructureFiles(activeUrl: string) {
		const sync = new CashierSync(activeUrl, _ptaSystem);

		const fileContents = await Promise.all(
			InfrastructureFiles.map((fileName) => sync.readInfrastructureFile(fileName))
		);

		const files: Record<string, string> = {};
		InfrastructureFiles.forEach((fileName, index) => {
			files[fileName] = fileContents[index];
		});

		await doSyncInfrastructureFiles(files);
		Notifier.success('Infrastructure files synchronized');
	}
</script>

<Toolbar title="Cashier Sync">
	{#snippet menuItems()}
		<ToolbarMenuItem text="Shut down server" Icon={PowerIcon} onclick={onShutdownClick} />
	{/snippet}
</Toolbar>

<main class="container mx-auto max-w-6xl space-y-4 p-1 lg:p-10">
	<div class="flex gap-6">
		<div>
			<p class="mb-2 font-medium">Select the data source:</p>
			<form class="space-y-2">
				<label class="flex items-center space-x-2">
					<input
						class="radio radio-primary bg-base-100"
						type="radio"
						name="config-source"
						value="filesystem"
						bind:group={configSource}
						onchange={onConfigSourceChanged}
					/>
					<span>Local filesystem</span>
				</label>
				<label class="flex items-center space-x-2">
					<input
						class="radio radio-primary bg-base-100"
						type="radio"
						name="config-source"
						value="rledger"
						bind:group={configSource}
						onchange={onConfigSourceChanged}
					/>
					<span>Cashier Server (Rust Ledger)</span>
				</label>
				<label class="flex items-center space-x-2">
					<input
						class="radio radio-primary bg-base-100"
						type="radio"
						name="config-source"
						value="beancount"
						bind:group={configSource}
						onchange={onConfigSourceChanged}
					/>
					<span>Cashier Server (Beancount)</span>
				</label>
				<label class="flex items-center space-x-2">
					<input
						class="radio radio-primary bg-base-100"
						type="radio"
						name="config-source"
						value="ledger"
						bind:group={configSource}
						onchange={onConfigSourceChanged}
					/>
					<span>Cashier Server (Ledger-cli)</span>
				</label>
			</form>
		</div>
		<div class="flex flex-1 items-center justify-center">
			<button class="btn btn-outline btn-primary rounded" type="button" onclick={onConfigureClick}>
				Configure
			</button>
		</div>
	</div>

	<center>
		<h3 class="text-3xl font-bold">Synchronization</h3>
	</center>

	<div class="flex flex-col space-y-8 pt-6">
		<label class="flex items-center space-x-2">
			<input
				class="checkbox checkbox-primary rounded"
				type="checkbox"
				bind:checked={syncAccounts}
				onchange={saveSettings}
			/>
			<p>Sync accounts and balances</p>
		</label>
		<label class="flex items-center space-x-2">
			<input
				class="checkbox checkbox-primary rounded"
				type="checkbox"
				bind:checked={syncAaValues}
				onchange={saveSettings}
			/>
			<p>Sync account balances in base currency, for asset allocation.</p>
		</label>
		<label class="flex items-center space-x-2">
			<input
				class="checkbox checkbox-primary rounded"
				type="checkbox"
				bind:checked={syncPayees}
				onchange={saveSettings}
			/>
			<p>Sync Payees</p>
		</label>
		<!-- <label class="flex items-center space-x-2">
			<input
				class="checkbox checkbox-primary rounded"
				type="checkbox"
				bind:checked={syncInfrastructureFiles}
				onchange={saveSettings}
			/>
			<p>Sync infrastructure files (book, commodities, accounts)</p>
		</label> -->
	</div>

	<center class="pt-10">
		<button class="btn bg-accent text-secondary rounded uppercase" onclick={onSyncClicked}>
			<span><RefreshCcw class={rotationClass} style="animation-direction: reverse;" /></span>
			<span>Synchronize</span>
		</button>
	</center>

	{#if _ptaSystem !== 'filesystem'}
		<hr class="my-10" />

		<center>
			<button class="btn text-accent bg-secondary mr-5 rounded uppercase" onclick={onShutdownClick}>
				<span><PowerIcon /></span>
				<span>Server Shutdown</span>
			</button>

			<button class="btn bg-primary text-accent rounded uppercase" onclick={reloadData}>
				<span><RefreshCcw class={rotationClass} style="animation-direction: reverse;" /></span>
				<span>Reload Data</span>
			</button>
		</center>
	{/if}
</main>
