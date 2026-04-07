<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import { onMount } from 'svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';

	Notifier.init();

	type SyncServerEntry = {
		id: string;
		name: string;
		url: string;
	};

	let syncServers = $state<SyncServerEntry[]>([]);
	let activeSyncServerId = $state('');

	let isServerDialogOpen = $state(false);
	let serverDialogMode = $state<'add' | 'edit'>('add');
	let serverFormId = $state('');
	let serverFormName = $state('');
	let serverFormUrl = $state('http://localhost:3000');

	onMount(async () => {
		await loadSettings();
	});

	async function loadSettings() {
		const storedServers = (await settings.get<SyncServerEntry[]>(SettingKeys.syncServers)) as
			| SyncServerEntry[]
			| null;
		syncServers = storedServers ?? [];

		const legacySyncUrl = (await settings.get<string>(SettingKeys.syncServerUrl)) as string | null;

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
		const serverUrl = activeServer?.url?.trim() ?? '';

		await settings.set(SettingKeys.syncActiveServerId, activeSyncServerId || null);
		await settings.set(SettingKeys.syncServerUrl, serverUrl || null);
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
</script>

<Toolbar title="Cashier Server - Beancount" />

<main class="container mx-auto max-w-6xl space-y-4 p-1 lg:p-10">
	<p>The Cashier Server must be running and accessible to synchronize data.</p>

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
</main>

<!-- Back FAB -->
<Fab onclick={() => history.back()} />

<input
	type="checkbox"
	id="sync-server-modal"
	class="modal-toggle"
	bind:checked={isServerDialogOpen}
/>
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
