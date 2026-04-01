<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { PowerIcon, RefreshCcw } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import appService from '$lib/services/appService';
	import CashierDAL from '$lib/data/dal';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { CashierSync } from '$lib/cashier-sync';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import { InfrastructureFiles } from '$lib/constants';
	import ledgerService from '$lib/services/ledgerService';

	Notifier.init();

	type SyncServerEntry = {
		id: string;
		name: string;
		url: string;
	};

	// let { data }: { data: PageData } = $props();

	let serverUrl = $state('');
	let _ptaSystem: string = '';
	let syncServers = $state<SyncServerEntry[]>([]);
	let activeSyncServerId = $state('');

	let isServerDialogOpen = $state(false);
	let serverDialogMode = $state<'add' | 'edit'>('add');
	let serverFormId = $state('');
	let serverFormName = $state('');
	let serverFormUrl = $state('http://localhost:3000');

	let syncAccounts = $state(false);
	let syncAaValues = $state(false);
	let syncPayees = $state(false);
	let syncInfrastructureFiles = $state(false);

	let rotationClass = $state('');

	onMount(async () => {
		// load sync settings
		await loadSettings();
	});

	async function loadSettings() {
		const storedServers = (await settings.get<SyncServerEntry[]>(
			SettingKeys.syncServers
		)) as SyncServerEntry[] | null;
		syncServers = storedServers ?? [];

		const legacySyncUrl = (await settings.get<string>(SettingKeys.syncServerUrl)) as
			| string
			| null;

		if (syncServers.length === 0 && legacySyncUrl) {
			const migratedEntry = {
				id: safeServerId(),
				name: 'Default',
				url: legacySyncUrl
			};
			syncServers = [migratedEntry];
			activeSyncServerId = migratedEntry.id;
			await persistServers();
		}

		const storedActiveSyncServerId = (await settings.get<string>(
			SettingKeys.syncActiveServerId
		)) as string | null;

		if (syncServers.length > 0) {
			const hasStoredSelection =
				!!storedActiveSyncServerId &&
				syncServers.some((entry) => entry.id === storedActiveSyncServerId);
			activeSyncServerId = hasStoredSelection
				? (storedActiveSyncServerId as string)
				: syncServers[0].id;
		} else {
			activeSyncServerId = '';
		}

		await syncActiveServerSelection();

		_ptaSystem = (await settings.get(SettingKeys.ptaSystem)) as string;

		syncAccounts = (await settings.get(SettingKeys.syncAccounts)) ?? false;
		syncAaValues = (await settings.get(SettingKeys.syncAaValues)) ?? false;
		syncPayees = (await settings.get(SettingKeys.syncPayees)) ?? false;
		syncInfrastructureFiles = (await settings.get(SettingKeys.syncInfrastructureFiles)) ?? false;
	}

	function safeServerId() {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}

		return `sync-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
	}

	function getActiveServer() {
		if (!activeSyncServerId) return null;

		return syncServers.find((entry) => entry.id === activeSyncServerId) ?? null;
	}

	async function persistServers() {
		await settings.set(SettingKeys.syncServers, syncServers);
	}

	async function syncActiveServerSelection() {
		const activeServer = getActiveServer();
		serverUrl = activeServer?.url?.trim() ?? '';

		await settings.set(SettingKeys.syncActiveServerId, activeSyncServerId || null);
		await settings.set(SettingKeys.syncServerUrl, serverUrl || null);
	}

	function getActiveServerUrlOrNotify() {
		const activeServer = getActiveServer();
		const activeUrl = activeServer?.url?.trim();

		if (!activeServer || !activeUrl) {
			Notifier.error('No sync server configured. Please add and select a sync server first.');
			return null;
		}

		return activeUrl;
	}

	async function onActiveServerChanged() {
		await syncActiveServerSelection();
	}

	function openAddServerDialog() {
		serverDialogMode = 'add';
		serverFormId = '';
		serverFormName = '';
		serverFormUrl = 'http://localhost:3000';
		isServerDialogOpen = true;
	}

	function openEditServerDialog() {
		const activeServer = getActiveServer();
		if (!activeServer) {
			Notifier.error('Select a sync server first.');
			return;
		}

		serverDialogMode = 'edit';
		serverFormId = activeServer.id;
		serverFormName = activeServer.name;
		serverFormUrl = activeServer.url;
		isServerDialogOpen = true;
	}

	function closeServerDialog() {
		isServerDialogOpen = false;
	}

	async function saveServerFromDialog() {
		const name = serverFormName.trim();
		const url = serverFormUrl.trim();

		if (!name || !url) {
			Notifier.error('Both Name and URL are required.');
			return;
		}

		if (serverDialogMode === 'add') {
			const entry = { id: safeServerId(), name, url };
			syncServers = [...syncServers, entry];
			activeSyncServerId = entry.id;
			Notifier.success('Sync server added.');
		} else {
			syncServers = syncServers.map((entry) =>
				entry.id === serverFormId ? { ...entry, name, url } : entry
			);
			Notifier.success('Sync server updated.');
		}

		await persistServers();
		await syncActiveServerSelection();
		closeServerDialog();
	}

	async function deleteServerFromDialog() {
		if (serverDialogMode !== 'edit' || !serverFormId) {
			return;
		}

		syncServers = syncServers.filter((entry) => entry.id !== serverFormId);

		if (!syncServers.some((entry) => entry.id === activeSyncServerId)) {
			activeSyncServerId = syncServers[0]?.id ?? '';
		}

		await persistServers();
		await syncActiveServerSelection();
		closeServerDialog();
		Notifier.success('Sync server deleted.');
	}

	async function reloadData() {
		const activeUrl = getActiveServerUrlOrNotify();
		if (!activeUrl) return;

		const sync = new CashierSync(activeUrl, _ptaSystem);
		await sync.reloadData();
	}

	/**
	 * shut the remote server down
	 */
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
		const activeUrl = getActiveServerUrlOrNotify();
		if (!activeUrl) return;

		rotationClass = rotationClass == '' ? 'animate-[spin_2s_linear_infinite]' : '';

		try {
			if (syncAccounts) {
				await synchronizeAccounts(activeUrl);
			}
			if (syncAaValues) {
				await synchronizeAaValues(activeUrl);
			}
			if (syncPayees) {
				await synchronizePayees(activeUrl);
			}
			if (syncInfrastructureFiles) {
				await synchronizeInfrastructureFiles(activeUrl);
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
		await settings.set(SettingKeys.syncInfrastructureFiles, syncInfrastructureFiles);
	}

	async function synchronizeAccounts(activeUrl: string) {
		const sync = new CashierSync(activeUrl, _ptaSystem);

		const report = await sync.readAccounts(_ptaSystem);
		if (!report || report.length == 0) {
			Notifier.error('No accounts received: ' + report);
			return;
		}

		// delete all accounts only after we have retrieved the new ones.
		await appService.deleteAccounts();
		await appService.importBalanceSheet(_ptaSystem, report);

		Notifier.success('Accounts fetched from Ledger');
	}

	async function synchronizeAaValues(activeUrl: string) {
		const sync = new CashierSync(activeUrl, _ptaSystem);

		try {
			await sync.readCurrentValues(_ptaSystem);

			Notifier.success('Asset Allocation values loaded');
		} catch (error: any) {
			console.error(error);
			Notifier.error(error.message);
		}
	}

	async function synchronizePayees(activeUrl: string) {
		const sync = new CashierSync(activeUrl, _ptaSystem);

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

	async function synchronizeInfrastructureFiles(activeUrl: string) {
		const sync = new CashierSync(activeUrl, _ptaSystem);

		// Fetch all infrastructure files using the generic method
		const fileContents = await Promise.all(
			InfrastructureFiles.map(fileName => sync.readInfrastructureFile(fileName))
		);

		await Promise.all(
			InfrastructureFiles.map((fileName, index) =>
				OpfsLib.saveFile(fileName, fileContents[index])
			)
		);

		await ledgerService.invalidate();

		Notifier.success('Infrastructure files synchronized');
	}
</script>

<Toolbar title="Cashier Sync">
	{#snippet menuItems()}
		<ToolbarMenuItem text="Shut down server" Icon={PowerIcon} onclick={onShutdownClick} />
	{/snippet}
</Toolbar>

<main class="container mx-auto max-w-6xl space-y-4 p-1 lg:p-10">
	<p>To update data from Ledger, the Cashier Server must be running and accessible.</p>
	<p>You can run the Cashier Server locally.</p>

	<div class="space-y-2">
		<label class="label" for="sync-server-select">
			<span>Sync Server</span>
		</label>
		<div class="flex flex-col gap-3 md:flex-row md:items-center">
			<select
				id="sync-server-select"
				class="select select-bordered w-full rounded"
				bind:value={activeSyncServerId}
				onchange={onActiveServerChanged}
			>
				<option value="">Select sync server</option>
				{#each syncServers as entry (entry.id)}
					<option value={entry.id}>{entry.name} ({entry.url})</option>
				{/each}
			</select>
			<div class="flex gap-2">
				<button class="btn btn-outline rounded" type="button" onclick={openEditServerDialog}
					>Edit</button
				>
				<button class="btn btn-primary rounded" type="button" onclick={openAddServerDialog}
					>Add</button
				>
			</div>
		</div>
	</div>

	<center>
		<h3 class="text-3xl font-bold">Synchronize</h3>
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
		<label class="flex items-center space-x-2">
			<input
				class="checkbox checkbox-primary rounded"
				type="checkbox"
				bind:checked={syncInfrastructureFiles}
				onchange={saveSettings}
			/>
			<p>Sync infrastructure files (book, commodities, accounts)</p>
		</label>
	</div>

	<center class="pt-10">
		<button class="btn bg-accent text-secondary rounded uppercase" onclick={onSyncClicked}>
			<span><RefreshCcw class={rotationClass} style="animation-direction: reverse;" /></span>
			<span>Sync</span>
		</button>
	</center>

	<hr class="my-10" />

	<center>
		<button class="btn text-accent bg-secondary mr-5 rounded uppercase" onclick={onShutdownClick}>
			<span><PowerIcon /></span>
			<span>Server Shutdown</span>
		</button>

		<!-- reload data -->
		<button class="btn bg-primary text-accent rounded uppercase" onclick={reloadData}>
			<span><RefreshCcw class={rotationClass} style="animation-direction: reverse;" /></span>
			<span>Reload Data</span>
		</button>
	</center>
</main>

<input type="checkbox" id="sync-server-modal" class="modal-toggle" bind:checked={isServerDialogOpen} />
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">
				{serverDialogMode === 'add' ? 'Add Sync Server' : 'Edit Sync Server'}
			</h2>
		</header>
		<article class="space-y-4 py-4">
			<label class="label flex-col items-start gap-2">
				<span>Name</span>
				<input
					type="text"
					class="input input-bordered w-full rounded"
					placeholder="Local Ledger"
					bind:value={serverFormName}
				/>
			</label>
			<label class="label flex-col items-start gap-2">
				<span>URL</span>
				<input
					type="text"
					class="input input-bordered w-full rounded"
					placeholder="http://localhost:3000"
					bind:value={serverFormUrl}
				/>
			</label>
		</article>
		<footer class="flex items-center justify-between gap-4">
			<div>
				{#if serverDialogMode === 'edit'}
					<button type="button" class="btn btn-error" onclick={deleteServerFromDialog}>Delete</button>
				{/if}
			</div>
			<div class="flex gap-4">
				<button type="button" class="btn btn-ghost" onclick={closeServerDialog}>Cancel</button>
				<button type="button" class="btn btn-primary" onclick={saveServerFromDialog}>Save</button>
			</div>
		</footer>
	</div>
</dialog>
