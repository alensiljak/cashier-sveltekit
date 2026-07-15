/**
 * Automatic WebDAV backup for cashier.bean.
 *
 * Call `scheduleBackup()` after any write to cashier.bean. The upload is
 * debounced so rapid successive writes (e.g. sort + save) coalesce into one
 * PUT. The backup runs silently in the background — no toast on success, a
 * console warning on failure. The /backup/webdav/ page shows the last-backup
 * timestamp via the exported `lastBackupTime` store.
 */

import { readFile } from '$lib/utils/opfslib';
import { WebDavClient } from '$lib/utils/webdav';
import { settings, deviceSettings, SettingKeys, DeviceSettingKeys } from '$lib/settings';
import { writable } from 'svelte/store';
import { showBackupNotification } from '$lib/utils/webNotification';

/** Shape of the webdavSettings user setting. */
export interface WebDavSettings {
	url: string;
	username: string;
	password: string;
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

	const content = await readFile('cashier.bean');
	if (content === undefined) return;

	try {
		const client = new WebDavClient(cfg.url, cfg.username, cfg.password);
		const res = await client.put('cashier.bean', content);
		if (res.ok) {
			lastBackupTime.set(new Date());
			void showBackupNotification();
		} else {
			console.warn(`[webdav-auto-backup] PUT failed: ${res.status} ${res.statusText}`);
		}
	} catch (err) {
		console.warn('[webdav-auto-backup] Upload error:', err);
	}
}

/**
 * Schedule a background upload of cashier.bean to WebDAV.
 * Debounced — multiple calls within 2 s coalesce into one upload.
 * Fire-and-forget: never throws, never blocks the caller.
 */
export function scheduleBackup(): void {
	clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		void doBackup();
	}, DEBOUNCE_MS);
}
