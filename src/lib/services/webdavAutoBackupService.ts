/**
 * Automatic WebDAV backup of the working set and the scheduled transactions\n * (the CRDT stores' Yjs state, one file each).
 *
 * Call `scheduleBackup()` after any write to the store. The upload is
 * debounced so rapid successive writes (e.g. sort + save) coalesce into one
 * PUT. The backup runs silently in the background — no toast on success, a
 * console warning on failure. The /backup/webdav/ page shows the last-backup
 * timestamp via the exported `lastBackupTime` store.
 */

import { WebDavClient } from '$lib/utils/webdav';
import { settings, deviceSettings, SettingKeys, DeviceSettingKeys } from '$lib/settings';
import { getXactStore } from '$lib/storage/xactStoreRegistry';
import { getScxStore } from '$lib/storage/scxStoreRegistry';
import { getDeviceId, ydocFilename, type DocKind } from '$lib/sync/ydocDevices';
import { writable } from 'svelte/store';
import { showBackupNotification } from '$lib/utils/webNotification';

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
	const enabled = await deviceSettings.get<boolean>(DeviceSettingKeys.webdavAutoBackup);
	if (!enabled) return;

	const cfg = await settings.get<WebDavSettings>(SettingKeys.webdavSettings);
	if (!cfg?.url) return;

	if (!navigator.onLine) return;

	const client = new WebDavClient(cfg.url, cfg.username, cfg.password);

	// Back up the Yjs document state to this device's own file.
	try {
		const store = await getXactStore();
		const filename = await crdtBackupFilename();
		const res = await client.put(filename, await store.exportState(), 'application/octet-stream');
		if (res.ok) {
			lastBackupTime.set(new Date());
			void showBackupNotification();
		} else {
			console.warn(`[webdav-auto-backup] PUT failed: ${res.status} ${res.statusText}`);
		}
	} catch (err) {
		console.warn('[webdav-auto-backup] Yjs upload error:', err);
	}

	// The scheduled transactions, once their store exists. A device that hasn't been
	// through the first-launch migration prompt yet is skipped: a background timer
	// must not create the store (that would pre-empt the prompt).
	try {
		const scxStore = await getScxStore();
		if (await scxStore.isInitialized()) {
			const res = await client.put(
				await crdtBackupFilename('scx'),
				await scxStore.exportState(),
				'application/octet-stream'
			);
			if (!res.ok) {
				console.warn(`[webdav-auto-backup] scx PUT failed: ${res.status} ${res.statusText}`);
			}
		}
	} catch (err) {
		console.warn('[webdav-auto-backup] scx upload error:', err);
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
