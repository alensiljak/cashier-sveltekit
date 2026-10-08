/**
 * Automatic backup of the working set and the scheduled transactions (the CRDT stores' Yjs
 * state, one file each) to WebDAV and, when the S3 option is enabled, to the S3 bucket.
 *
 * Call `scheduleBackup()` after any write to the store. The upload is
 * debounced so rapid successive writes (e.g. sort + save) coalesce into one
 * PUT. The backup runs in the background and reports the result with an app message. The /backup/webdav/ page shows the last-backup
 * timestamp via the exported `lastBackupTime` store.
 */

import { WebDavClient } from '$lib/utils/webdav';
import { settings, deviceSettings, SettingKeys, DeviceSettingKeys } from '$lib/settings';
import { getXactStore } from '$lib/storage/xactStoreRegistry';
import { getScxStore } from '$lib/storage/scxStoreRegistry';
import { getDeviceId, ydocFilename, type DocKind } from '$lib/sync/ydocDevices';
import { writable } from 'svelte/store';
import Notifier from '$lib/utils/notifier';

/** Shape of the webdavSettings user setting. */
export interface WebDavSettings {
	url: string;
	username: string;
	password: string;
}

/** Remote timestamps (ISO) recorded in DeviceSettingKeys.webdavLastSyncTs at the last sync. */
export interface WebDavLastSyncTs {
	settings: string | null;
}

/**
 * Per-device file name for the Yjs state. Each device writes only its own file,
 * so concurrent devices never overwrite each other. Shares the device ID with peer sync.
 */
export async function crdtBackupFilename(kind: DocKind = 'xacts'): Promise<string> {
	return ydocFilename(await getDeviceId(), kind);
}

/** Reactive timestamp of the most recent successful auto-backup (null = never). */
export const lastBackupTime = writable<Date | null>(null);

const DEBOUNCE_MS = 2000;

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

async function doBackup(): Promise<void> {
	await Promise.all([doWebDavBackup(), doS3Backup()]);
}

/**
 * Back up to S3 when the S3 option is enabled in the settings and the bucket is configured.
 * Imported on demand: s3Sync pulls in the store registries, which import this module.
 */
async function doS3Backup(): Promise<void> {
	try {
		if (!(await deviceSettings.get<boolean>(DeviceSettingKeys.s3AutoBackup))) return;

		const { isSyncOptionEnabled } = await import('$lib/services/syncOptions.svelte');
		if (!(await isSyncOptionEnabled('s3'))) return;

		const { loadS3Config, isS3Configured } = await import('$lib/services/s3Config');
		const cfg = await loadS3Config();
		if (!isS3Configured(cfg) || !cfg.passphrase) return;

		if (!navigator.onLine) return;

		const { backupCrdtStores } = await import('$lib/services/s3Sync');
		const failed = await backupCrdtStores(cfg);
		if (failed.length) throw new Error(failed.map((l) => l.message).join('; '));
		lastBackupTime.set(new Date());
		Notifier.success('Journal backed up to S3');
	} catch (err) {
		console.warn('[s3-auto-backup] error:', err);
		Notifier.error(`S3 backup failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Uploads this device's Yjs state files to WebDAV. Resolves to the error messages (empty on
 * success). Shared by the automatic backup and the home-screen sync.
 */
export async function uploadCrdtState(client: WebDavClient): Promise<string[]> {
	const errors: string[] = [];

	// The working set.
	try {
		const store = await getXactStore();
		const filename = await crdtBackupFilename();
		const res = await client.put(filename, await store.exportState(), 'application/octet-stream');
		if (res.ok) lastBackupTime.set(new Date());
		else errors.push(`${filename}: ${res.status} ${res.statusText}`);
	} catch (err) {
		errors.push(err instanceof Error ? err.message : String(err));
	}

	// The scheduled transactions, once their store exists. A device that hasn't been
	// through the first-launch migration prompt yet is skipped: a background timer
	// must not create the store (that would pre-empt the prompt).
	try {
		const scxStore = await getScxStore();
		if (await scxStore.isInitialized()) {
			const filename = await crdtBackupFilename('scx');
			const res = await client.put(
				filename,
				await scxStore.exportState(),
				'application/octet-stream'
			);
			if (!res.ok) errors.push(`${filename}: ${res.status} ${res.statusText}`);
		}
	} catch (err) {
		errors.push(err instanceof Error ? err.message : String(err));
	}
	return errors;
}

async function doWebDavBackup(): Promise<void> {
	const enabled = await deviceSettings.get<boolean>(DeviceSettingKeys.webdavAutoBackup);
	if (!enabled) return;

	// The option must also be switched on in the sync settings.
	const { isSyncOptionEnabled } = await import('$lib/services/syncOptions.svelte');
	if (!(await isSyncOptionEnabled('webdav'))) return;

	const cfg = await settings.get<WebDavSettings>(SettingKeys.webdavSettings);
	if (!cfg?.url) return;

	if (!navigator.onLine) return;

	const client = new WebDavClient(cfg.url, cfg.username, cfg.password);
	const errors = await uploadCrdtState(client);
	if (errors.length) {
		console.warn('[webdav-auto-backup] upload failed:', errors);
		Notifier.error(`WebDAV backup failed: ${errors.join('; ')}`);
	} else {
		Notifier.success('Journal backed up to WebDAV');
	}
}
/**
 * Schedule a background upload of the working set to WebDAV.
 * Debounced — multiple calls within 2 s coalesce into one upload.
 * Fire-and-forget: never throws, never blocks the caller.
 */
export function scheduleBackup(): void {
	clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		void doBackup();
	}, DEBOUNCE_MS);
}
