/**
 * Headless check and full sync of the CRDT stores (working set, scheduled transactions) with a
 * WebDAV folder, for the home-screen Sync card. The /backup/webdav page does the same with more
 * options and reporting. The work is in webdavDelta.ts.
 */
import { settings, SettingKeys } from '#lib/settings';
import { WebDavClient } from '#lib/utils/webdav';
import type { WebDavSettings } from './webdavAutoBackupService';

export { checkWebDav, syncWebDav } from './webdavDelta';

export async function loadWebDavClient(): Promise<WebDavClient | null> {
	const cfg = await settings.get<WebDavSettings>(SettingKeys.webdavSettings);
	return cfg?.url ? new WebDavClient(cfg.url, cfg.username, cfg.password) : null;
}
