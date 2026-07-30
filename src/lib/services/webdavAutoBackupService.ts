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
import { normalizeEol } from '$lib/sync/SyncSource';
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

/**
 * Baseline record persisted in DeviceSettingKeys.webdavLastSyncTs.
 * Stored as `{ remoteTs, localHash }` after any sync; legacy plain ISO strings
 * are accepted and treated as having no local hash (timestamp-only baseline).
 */
export type SyncRecord = string | { remoteTs: string; localHash: string };
export interface WebDavLastSyncTs {
	settings: string | null;
	cashierBean: SyncRecord | null;
	scheduled: string | null;
}

/** SHA-256 hex of EOL-normalised content — consistent with peer-sync hashing. */
export async function contentHash(content: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(normalizeEol(content))
	);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** Updates the cashierBean baseline after any successful upload (manual or auto). */
export async function updateCashierBeanBaseline(
	content: string,
	remoteTs: Date
): Promise<void> {
	const stored = await deviceSettings.get<WebDavLastSyncTs>(DeviceSettingKeys.webdavLastSyncTs);
	const baseline: WebDavLastSyncTs = stored ?? { settings: null, cashierBean: null, scheduled: null };
	baseline.cashierBean = { remoteTs: remoteTs.toISOString(), localHash: await contentHash(content) };
	await deviceSettings.set(DeviceSettingKeys.webdavLastSyncTs, baseline);
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
			// Update the sync baseline so the backup page doesn't show a stale conflict.
			// HEAD the file to get the server-assigned Last-Modified timestamp.
			const remoteTs = await client.lastModified('cashier.bean');
			if (remoteTs) void updateCashierBeanBaseline(content, remoteTs);
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
