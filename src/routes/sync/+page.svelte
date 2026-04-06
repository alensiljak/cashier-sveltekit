<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { BoxIcon, PowerIcon, RefreshCcw } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import * as SyncBeancount from '$lib/sync/sync-beancount';
	import { LedgerDataSource } from '$lib/enums';
	import { goto } from '$app/navigation';
	import * as cashierFsSync from '$lib/sync/sync-fs';
	import ledgerService from '$lib/services/ledgerService';
	import { syncProgress } from '$lib/stores/syncProgressStore';

	Notifier.init();

	let syncAccounts = $state(false);
	let syncAaValues = $state(false);
	let syncAssetAllocation = $state(false);
	let syncPayees = $state(false);
	let syncInfrastructureFiles = $state(false);
	let syncOpeningBalances = $state(false);

	let rotationClass = $state('');
	let syncStarted = $state(false);
	let syncing = $state(false);

	let configSource = $state<LedgerDataSource>(LedgerDataSource.filesystem);

	let serverUrl = $state('');
	let _dataSource = $state('');

	onMount(async () => {
		await loadSettings();
	});

	async function loadSettings() {
		serverUrl = ((await settings.get<string>(SettingKeys.syncServerUrl)) as string | null) ?? '';
		_dataSource = ((await settings.get(SettingKeys.ledgerDataSource)) as string) ?? '';
		if (_dataSource) configSource = _dataSource as LedgerDataSource;

		syncAccounts = (await settings.get(SettingKeys.syncAccounts)) ?? false;
		syncAaValues = (await settings.get(SettingKeys.syncAaValues)) ?? false;
		syncAssetAllocation = (await settings.get(SettingKeys.syncAssetAllocation)) ?? false;
		syncPayees = (await settings.get(SettingKeys.syncPayees)) ?? false;
		syncInfrastructureFiles = (await settings.get(SettingKeys.syncInfrastructureFiles)) ?? false;
		syncOpeningBalances = (await settings.get(SettingKeys.syncOpeningBalances)) ?? false;
	}

	async function onConfigSourceChanged() {
		_dataSource = configSource;
		await settings.set(SettingKeys.ledgerDataSource, configSource);
	}

	function onConfigureClick() {
		switch (configSource) {
			case LedgerDataSource.filesystem:
				goto('/sync/filesystem');
				break;
			case LedgerDataSource.beancount:
				goto('/sync/beancount');
				break;
			case LedgerDataSource.rledger:
				Notifier.warning('Configure Cashier Server (Rust Ledger) - Not implemented yet.');
				break;
			case LedgerDataSource.ledger:
				Notifier.warning('Configure Cashier Server (Ledger-cli) - Not implemented yet.');
				break;
		}
	}

	async function onOpfsClick() {
		// navigate to OPFS page
		await goto('/opfs');
	}

	async function onShutdownClick() {
		const activeUrl = await settings.get<string>(SettingKeys.syncServerUrl);
		if (!activeUrl) {
			Notifier.error('No active server URL found. Please configure the server URL first.');
			return;
		}

		const sync = new SyncBeancount.CashierSyncBeancount(activeUrl);
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

		syncing = true;
		syncStarted = true;
		rotationClass = rotationClass == '' ? 'animate-[spin_2s_linear_infinite]' : '';

		try {
			let syncOptions: SyncBeancount.SyncSteps = {
				syncAccounts,
				syncAaValues,
				syncAssetAllocation,
				syncPayees,
				syncOpeningBalances
			};

			let syncResult = false;
			// check which backend to synchronize with.
			switch (configSource) {
				case LedgerDataSource.filesystem:
					syncResult = await cashierFsSync.synchronize(syncOptions);
					break;
				case LedgerDataSource.beancount:
					// cashier-server-python
					syncResult = await SyncBeancount.synchronize(syncOptions);
					break;
				case LedgerDataSource.rledger:
					// cashier-server-rust
					Notifier.warning(
						'Synchronization with Cashier Server (Rust Ledger) not implemented yet.'
					);
					break;
				case LedgerDataSource.ledger:
					Notifier.warning('Synchronization with Cashier Server (Ledger-cli) not implemented yet.');
					break;
			}

			if (!syncResult) {
				throw new Error('Synchronization failed. Please check the logs for more details.');
			}

			// invalidate cache and reload data
			await ledgerService.invalidate();

			Notifier.success('Synchronization completed successfully!');
			rotationClass = '';
			syncing = false;

		} catch (error: any) {
			rotationClass = '';
			syncing = false;
			console.error(error);
			Notifier.error(error.message);
		}
	}

	async function reloadData() {
		const activeUrl = await settings.get<string>(SettingKeys.syncServerUrl);
		if (!activeUrl) return;

		const sync = new SyncBeancount.CashierSyncBeancount(activeUrl);
		await sync.reloadData();
	}

	async function saveSettings() {
		await settings.set(SettingKeys.syncAccounts, syncAccounts);
		await settings.set(SettingKeys.syncOpeningBalances, syncOpeningBalances);
		await settings.set(SettingKeys.syncAaValues, syncAaValues);
		await settings.set(SettingKeys.syncAssetAllocation, syncAssetAllocation);
		await settings.set(SettingKeys.syncPayees, syncPayees);
		await settings.set(SettingKeys.syncInfrastructureFiles, syncInfrastructureFiles);
	}

	function toggleAllCheckboxes(checked: boolean) {
		syncAccounts = checked;
		syncAaValues = checked;
		syncAssetAllocation = checked;
		syncPayees = checked;
		syncOpeningBalances = checked;
		syncInfrastructureFiles = checked;

		saveSettings();
	}
</script>

<Toolbar title="Cashier Sync">
	{#snippet menuItems()}
		<ToolbarMenuItem text="Shut down server" Icon={PowerIcon} onclick={onShutdownClick} />
		<ToolbarMenuItem text="OPFS Storage" Icon={BoxIcon} onclick={onOpfsClick} />
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
						value={LedgerDataSource.filesystem}
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
						value={LedgerDataSource.rledger}
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
						value={LedgerDataSource.beancount}
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
						value={LedgerDataSource.ledger}
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

	{#snippet statusIcon(status: string | undefined)}
		{#if status === 'in-progress'}
			<span class="loading loading-spinner loading-sm"></span>
		{:else if status === 'completed'}
			<span class="text-success">✓</span>
		{:else if status === 'error'}
			<span class="text-error">✗</span>
		{:else}
			<span class="inline-block w-4"></span>
		{/if}
	{/snippet}

	<table class="table table-zebra w-full table-raised border border-base-300 rounded-xl">
		<thead>
			<tr>
				<th class="w-0.5">
					<input
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncInfrastructureFiles}
						onchange={(e) => toggleAllCheckboxes(e.target?.checked)}
					/>
				</th>
				<th>Data type</th>
				{#if syncStarted}<th class="w-0.5"></th>{/if}
			</tr>
		</thead>
		<tbody>
			<tr>
				<td>
					<input
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncAccounts}
						onchange={saveSettings}
					/>
				</td>
				<td onclick={() => syncAccounts = !syncAccounts} class="cursor-pointer">
					Accounts
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 1)?.status)}</td>{/if}
			</tr>
			<tr>
				<td>
					<input
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncOpeningBalances}
						onchange={saveSettings}
					/>
				</td>
				<td onclick={() => syncOpeningBalances = !syncOpeningBalances} class="cursor-pointer">
					Opening balances
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 2)?.status)}</td>{/if}
			</tr>
			<tr>
				<td>
					<input
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncAssetAllocation}
						onchange={saveSettings}
					/>
				</td>
				<td onclick={() => syncAssetAllocation = !syncAssetAllocation} class="cursor-pointer">
					Asset Allocation definition
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 3)?.status)}</td>{/if}
			</tr>
			<tr>
				<td>
					<input
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncAaValues}
						onchange={saveSettings}
					/>
				</td>
				<td onclick={() => syncAaValues = !syncAaValues} class="cursor-pointer">
					Account current values (for asset allocation)
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 4)?.status)}</td>{/if}
			</tr>
			<tr>
				<td>
					<input
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncPayees}
						onchange={saveSettings}
					/>
				</td>
				<td onclick={() => syncPayees = !syncPayees} class="cursor-pointer">
					Payees
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 5)?.status)}</td>{/if}
			</tr>
		</tbody>
	</table>

	<center class="pt-10">
		<button
			class="btn bg-accent text-secondary rounded uppercase"
			onclick={onSyncClicked}
			disabled={syncing}
		>
			<span><RefreshCcw class={rotationClass} style="animation-direction: reverse;" /></span>
			<span>Synchronize</span>
		</button>
	</center>

	{#if _dataSource !== LedgerDataSource.filesystem}
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
