<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import { settings, deviceSettings, SettingKeys, DeviceSettingKeys } from '$lib/settings';
	import { ScheduledTransaction, Setting } from '$lib/data/model';
	import db from '$lib/data/db';
	import { readFile, saveFile, getFileMetadata } from '$lib/utils/opfslib';
	import Notifier from '$lib/utils/notifier';
	import { WebDavClient } from '$lib/utils/webdav';
	import {
		SettingsIcon,
		RefreshCwIcon,
		GitCompareArrowsIcon,
		EyeIcon,
		CloudIcon,
		ArrowUpIcon,
		ArrowDownIcon,
		XIcon
	} from '@lucide/svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { goto } from '$app/navigation';
	import { lastBackupTime } from '$lib/services/webdavAutoBackupService';
	import { requestNotificationPermission } from '$lib/utils/webNotification';

	type LastSyncTs = { settings: string | null; cashierBean: string | null; scheduled: string | null };
	type SyncDirection = 'up' | 'down' | 'conflict' | null;

	let includeSettings = $state(false);
	let includeCashierBean = $state(false);
	let includeScheduled = $state(false);
	let showDownloadDialog = $state(false);
	let webdavUrl = $state('');
	let webdavUsername = $state('');
	let webdavPassword = $state('');
	let isUploading = $state(false);
	let isDownloading = $state(false);
	let isCheckingRemote = $state(false);
	let settingsLastModified = $state<Date | null>(null);
	let cashierBeanLastModified = $state<Date | null>(null);
	let cashierBeanLocalLastModified = $state<Date | null>(null);
	let scheduledLastModified = $state<Date | null>(null);
	let autoBackupEnabled = $state(false);
	let lastSyncTs = $state<LastSyncTs>({ settings: null, cashierBean: null, scheduled: null });

	// cashier.bean: full conflict detection via lastSyncTs baseline; falls back to simple comparison
	const cashierBeanDirection = $derived.by<SyncDirection>(() => {
		const remote = cashierBeanLastModified;
		const local = cashierBeanLocalLastModified;
		if (!remote && !local) return null;
		const base = lastSyncTs.cashierBean ? new Date(lastSyncTs.cashierBean) : null;
		if (base) {
			const localChanged = local != null && local > base;
			const remoteChanged = remote != null && remote > base;
			if (localChanged && remoteChanged) return 'conflict';
			if (localChanged) return 'up';
			if (remoteChanged) return 'down';
			return null;
		}
		// No baseline: simple comparison
		if (!remote) return local ? 'up' : null;
		if (!local) return 'down';
		if (local > remote) return 'up';
		if (remote > local) return 'down';
		return null;
	});

	// settings/scheduled: no local timestamp — only detect remote changed since last sync
	const settingsDirection = $derived.by<SyncDirection>(() => {
		if (!settingsLastModified || !lastSyncTs.settings) return null;
		return settingsLastModified > new Date(lastSyncTs.settings) ? 'down' : null;
	});

	const scheduledDirection = $derived.by<SyncDirection>(() => {
		if (!scheduledLastModified || !lastSyncTs.scheduled) return null;
		return scheduledLastModified > new Date(lastSyncTs.scheduled) ? 'down' : null;
	});

	const noneSelected = $derived(!includeSettings && !includeCashierBean && !includeScheduled);
	const allSelected = $derived(includeSettings && includeCashierBean && includeScheduled);
	const someSelected = $derived(includeSettings || includeCashierBean || includeScheduled);
	let indeterminate = $state(false);
	$effect(() => {
		indeterminate = someSelected && !allSelected;
	});

	function toggleSelectAll() {
		const next = !allSelected;
		includeSettings = next;
		includeCashierBean = next;
		includeScheduled = next;
	}

	onMount(async () => {
		const saved = await settings.get<{ url: string; username: string; password: string }>(
			SettingKeys.webdavSettings
		);
		webdavUrl = saved?.url ?? '';
		webdavUsername = saved?.username ?? '';
		webdavPassword = saved?.password ?? '';
		autoBackupEnabled =
			(await deviceSettings.get<boolean>(DeviceSettingKeys.webdavAutoBackup)) ?? false;
		const storedSyncTs = await deviceSettings.get<LastSyncTs>(DeviceSettingKeys.webdavLastSyncTs);
		if (storedSyncTs) lastSyncTs = storedSyncTs;
		fetchLastModified();
	});

	async function saveLastSyncTs() {
		await deviceSettings.set(DeviceSettingKeys.webdavLastSyncTs, { ...lastSyncTs });
	}

	async function toggleAutoBackup() {
		autoBackupEnabled = !autoBackupEnabled;
		await deviceSettings.set(DeviceSettingKeys.webdavAutoBackup, autoBackupEnabled);
		if (autoBackupEnabled) {
			await requestNotificationPermission();
		}
	}

	async function fetchLastModified() {
		isCheckingRemote = true;
		try {
			const localMeta = await getFileMetadata('cashier.bean');
			if (localMeta) cashierBeanLocalLastModified = new Date(localMeta.lastModified);

			if (!webdavUrl) return;
			const dav = client();
			const [sm, cm, scm] = await Promise.allSettled([
				dav.lastModified('settings.json'),
				dav.lastModified('cashier.bean'),
				dav.lastModified('scheduled.json')
			]);
			if (sm.status === 'fulfilled') settingsLastModified = sm.value;
			if (cm.status === 'fulfilled') cashierBeanLastModified = cm.value;
			if (scm.status === 'fulfilled') scheduledLastModified = scm.value;
		} finally {
			isCheckingRemote = false;
		}
	}

	function client() {
		return new WebDavClient(webdavUrl, webdavUsername, webdavPassword);
	}

	function fileParams(): URLSearchParams {
		const p = new URLSearchParams();
		if (includeSettings) p.append('f', 'settings');
		if (includeCashierBean) p.append('f', 'bean');
		if (includeScheduled) p.append('f', 'scheduled');
		return p;
	}

	async function upload() {
		if (!webdavUrl) {
			Notifier.error('WebDAV URL is not configured');
			return;
		}
		isUploading = true;
		const dav = client();
		const uploaded = { settings: false, cashierBean: false, scheduled: false };
		try {
			if (includeSettings) {
				const allSettings = await settings.getAll();
				const json = JSON.stringify(allSettings, null, 2);
				const res = await dav.put('settings.json', json, 'application/json; charset=utf-8');
				if (res.ok) { Notifier.success('Settings uploaded'); uploaded.settings = true; }
				else Notifier.error(`Upload failed for settings.json: ${res.status} ${res.statusText}`);
			}
			if (includeCashierBean) {
				const content = await readFile('cashier.bean');
				if (content === undefined) {
					Notifier.error('cashier.bean not found in private filesystem');
				} else {
					const res = await dav.put('cashier.bean', content);
					if (res.ok) { Notifier.success('cashier.bean uploaded'); uploaded.cashierBean = true; }
					else Notifier.error(`Upload failed for cashier.bean: ${res.status} ${res.statusText}`);
				}
			}
			if (includeScheduled) {
				const all = await db.scheduled.toArray();
				const json = JSON.stringify(all, null, 2);
				const res = await dav.put('scheduled.json', json, 'application/json; charset=utf-8');
				if (res.ok) { Notifier.success('Scheduled transactions uploaded'); uploaded.scheduled = true; }
				else Notifier.error(`Upload failed for scheduled.json: ${res.status} ${res.statusText}`);
			}
		} catch (err) {
			Notifier.error('Upload error: ' + (err as Error).message);
		} finally {
			isUploading = false;
			await fetchLastModified();
			// Record fresh remote timestamps as the new sync baseline for uploaded files
			if (uploaded.settings && settingsLastModified)
				lastSyncTs.settings = settingsLastModified.toISOString();
			if (uploaded.cashierBean && cashierBeanLastModified)
				lastSyncTs.cashierBean = cashierBeanLastModified.toISOString();
			if (uploaded.scheduled && scheduledLastModified)
				lastSyncTs.scheduled = scheduledLastModified.toISOString();
			if (uploaded.settings || uploaded.cashierBean || uploaded.scheduled)
				await saveLastSyncTs();
		}
	}

	function onDownloadClick() {
		showDownloadDialog = true;
	}

	async function confirmDownload() {
		showDownloadDialog = false;
		if (!webdavUrl) {
			Notifier.error('WebDAV URL is not configured');
			return;
		}
		isDownloading = true;
		const dav = client();
		const downloaded = { settings: false, cashierBean: false, scheduled: false };
		try {
			if (includeSettings) {
				const res = await dav.get('settings.json');
				if (res.ok) {
					const entries: Setting[] = JSON.parse(await res.text());
					await db.settings.clear();
					await db.settings.bulkPut(entries.map((e) => new Setting(e.key, e.value)));
					Notifier.success('Settings restored');
					downloaded.settings = true;
				} else {
					Notifier.error(`Download failed for settings.json: ${res.status} ${res.statusText}`);
				}
			}
			if (includeCashierBean) {
				const res = await dav.get('cashier.bean');
				if (res.ok) {
					await saveFile('cashier.bean', await res.text());
					Notifier.success('cashier.bean restored');
					downloaded.cashierBean = true;
				} else {
					Notifier.error(`Download failed for cashier.bean: ${res.status} ${res.statusText}`);
				}
			}
			if (includeScheduled) {
				const res = await dav.get('scheduled.json');
				if (res.ok) {
					const entries: ScheduledTransaction[] = JSON.parse(await res.text());
					await db.scheduled.clear();
					await db.scheduled.bulkPut(entries);
					Notifier.success('Scheduled transactions restored');
					downloaded.scheduled = true;
				} else {
					Notifier.error(`Download failed for scheduled.json: ${res.status} ${res.statusText}`);
				}
			}
		} catch (err) {
			Notifier.error('Download error: ' + (err as Error).message);
		} finally {
			isDownloading = false;
			// Record the remote timestamps we just downloaded as the new sync baseline
			if (downloaded.settings && settingsLastModified)
				lastSyncTs.settings = settingsLastModified.toISOString();
			if (downloaded.cashierBean && cashierBeanLastModified)
				lastSyncTs.cashierBean = cashierBeanLastModified.toISOString();
			if (downloaded.scheduled && scheduledLastModified)
				lastSyncTs.scheduled = scheduledLastModified.toISOString();
			if (downloaded.settings || downloaded.cashierBean || downloaded.scheduled)
				await saveLastSyncTs();
			// Refresh local metadata (cashier.bean was overwritten)
			if (downloaded.cashierBean) fetchLastModified();
		}
	}

	function cancelDownload() {
		showDownloadDialog = false;
	}

	function openDiff() {
		goto(`/backup/webdav/diff?${fileParams()}`);
	}

	function openPreview(source: 'local' | 'remote') {
		goto(`/backup/webdav/preview?source=${source}&${fileParams()}`);
	}

	const selectedLabels = $derived([
		...(includeSettings ? ['Settings'] : []),
		...(includeCashierBean ? ['cashier.bean'] : []),
		...(includeScheduled ? ['Scheduled Transactions'] : [])
	]);
</script>

{#snippet menuItems()}
	<ToolbarMenuItem text="WebDAV Config" Icon={SettingsIcon} targetNav="/settings/webdav-cfg" />
{/snippet}

{#snippet actions()}
	<HelpButton topic="webdav-backup" />
{/snippet}

{#snippet syncBadge(remoteMod: Date | null, direction: SyncDirection)}
	{#if remoteMod}
		{@const isConflict = direction === 'conflict'}
		{@const isUp = direction === 'up'}
		{@const isDown = direction === 'down'}
		<span
			class="flex items-center gap-1 text-xs {isConflict
				? 'text-error'
				: isUp
					? 'text-success'
					: isDown
						? 'text-error'
						: 'text-base-content/50'}"
			title={isConflict
				? 'Conflict — both local and remote changed since last sync'
				: isUp
					? 'Local is newer — consider uploading'
					: isDown
						? 'Remote is newer — consider downloading'
						: 'Remote timestamp'}
		>
			{#if isConflict}
				<XIcon size={12} />
			{:else if isUp}
				<ArrowUpIcon size={12} />
			{:else if isDown}
				<ArrowDownIcon size={12} />
			{:else}
				<CloudIcon size={12} class="text-base-content/40" />
			{/if}
			{remoteMod.toLocaleString()}
		</span>
	{/if}
{/snippet}

<Toolbar title="WebDAV Backup" {menuItems} {actions} />

<main class="p-4 flex flex-col gap-6 mx-auto max-w-2xl w-full">
	{#if !webdavUrl}
		<section>
			<p>
				Make sure that you <a href="/settings/webdav-cfg" class="link link-primary">configure</a> your
				WebDAV connection before backup operations.
			</p>
		</section>
	{/if}
	<section class="my-4">
		<div class="flex items-center justify-between mb-3">
			<h2 class="text-lg font-semibold">Files</h2>
			{#if isCheckingRemote}
				<RefreshCwIcon size={14} class="animate-spin text-base-content/40" />
			{:else if webdavUrl}
				<button
					class="text-xs text-base-content/40 hover:text-base-content/70 flex items-center gap-1 cursor-pointer"
					onclick={fetchLastModified}
				>
					<RefreshCwIcon size={12} />
					refresh
				</button>
			{/if}
		</div>
		<div class="flex flex-col gap-3">
			<label class="flex items-center gap-3 cursor-pointer">
				<input
					type="checkbox"
					class="checkbox checkbox-primary"
					checked={allSelected}
					bind:indeterminate
					onclick={toggleSelectAll}
				/>
				<span class="flex-1 text-sm text-base-content/60">Select all</span>
			</label>
			<div class="divider my-0"></div>
			<label class="flex items-center gap-3 cursor-pointer">
				<input
					type="checkbox"
					class="checkbox checkbox-primary"
					bind:checked={includeCashierBean}
				/>
				<span class="flex-1">cashier.bean</span>
				{@render syncBadge(cashierBeanLastModified, cashierBeanDirection)}
			</label>
			<label class="flex items-center gap-3 cursor-pointer">
				<input type="checkbox" class="checkbox checkbox-primary" bind:checked={includeSettings} />
				<span class="flex-1">Settings</span>
				{@render syncBadge(settingsLastModified, settingsDirection)}
			</label>
			<label class="flex items-center gap-3 cursor-pointer">
				<input type="checkbox" class="checkbox checkbox-primary" bind:checked={includeScheduled} />
				<span class="flex-1">Scheduled Transactions</span>
				{@render syncBadge(scheduledLastModified, scheduledDirection)}
			</label>
		</div>
	</section>

	<!-- Auto-backup -->
	<section class="card bg-base-200">
		<div class="card-body p-4 gap-3">
			<label class="flex items-center gap-3 cursor-pointer">
				<span class="flex-1">
					<span class="font-medium">Auto-backup cashier.bean</span>
					<span class="block text-xs text-base-content/50">
						Upload to WebDAV automatically after each change
					</span>
				</span>
				<input
					type="checkbox"
					class="toggle toggle-primary bg-transparent bg-none"
					checked={autoBackupEnabled}
					disabled={!webdavUrl}
					onclick={toggleAutoBackup}
				/>
			</label>
			{#if $lastBackupTime}
				<p class="text-xs text-base-content/50 flex items-center gap-1">
					<CloudIcon size={12} />
					Last auto-backup: {$lastBackupTime.toLocaleString()}
				</p>
			{/if}
		</div>
	</section>

	<!-- Primary actions -->
	<section class="flex gap-3 justify-center">
		<button class="btn btn-primary" disabled={noneSelected || isUploading} onclick={upload}>
			{#if isUploading}<span class="loading loading-spinner loading-sm"></span>{/if}
			Upload
		</button>
		<button
			class="btn btn-outline btn-error"
			disabled={noneSelected || isDownloading}
			onclick={onDownloadClick}
		>
			{#if isDownloading}<span class="loading loading-spinner loading-sm"></span>{/if}
			Download
		</button>
	</section>

	<!-- View actions -->
	<section class="flex gap-3 justify-center flex-wrap">
		<button class="btn btn-secondary" disabled={noneSelected} onclick={openDiff}>
			<GitCompareArrowsIcon size={16} />
			Diff
		</button>
		<button class="btn btn-outline" disabled={noneSelected} onclick={() => openPreview('local')}>
			<EyeIcon size={16} />
			Preview Local
		</button>
		<button class="btn btn-outline" disabled={noneSelected} onclick={() => openPreview('remote')}>
			<EyeIcon size={16} />
			Preview Remote
		</button>
	</section>
</main>

<!-- Download confirmation dialog -->
{#if showDownloadDialog}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">Confirm Download</h3>
			<p class="py-4">
				The local content of
				<strong>{selectedLabels.join(' and ')}</strong>
				will be overwritten by the remote version. Continue?
			</p>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={cancelDownload}>Cancel</button>
				<button class="btn btn-warning" onclick={confirmDownload}>Overwrite</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={cancelDownload}></button>
	</div>
{/if}
