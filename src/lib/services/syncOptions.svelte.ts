/*
	Which backup/sync options the user has enabled on this device.
	Drives the menu entries and the Backup & Sync card in Settings.
*/
import { DeviceSettingKeys, SettingKeys, deviceSettings, settings } from '$lib/settings';

export type SyncOption = 'webdav' | 's3' | 'peer';

const enabledKeys: Record<SyncOption, string> = {
	webdav: DeviceSettingKeys.syncWebdavEnabled,
	s3: DeviceSettingKeys.syncS3Enabled,
	peer: DeviceSettingKeys.syncPeerEnabled
};

/** An option that was never toggled counts as enabled if it was already configured. */
async function isConfigured(option: SyncOption): Promise<boolean> {
	switch (option) {
		case 'webdav':
			return !!(await settings.get<{ url?: string }>(SettingKeys.webdavSettings))?.url;
		case 's3':
			return !!(await deviceSettings.get(DeviceSettingKeys.s3Settings));
		case 'peer':
			return !!(await settings.get<string>(SettingKeys.peerRoom));
	}
}

class SyncOptions {
	webdav = $state(false);
	s3 = $state(false);
	peer = $state(false);
	loaded = $state(false);

	async load() {
		for (const option of Object.keys(enabledKeys) as SyncOption[]) {
			const stored = await deviceSettings.get<boolean>(enabledKeys[option]);
			this[option] = stored ?? (await isConfigured(option));
		}
		this.loaded = true;
	}

	async set(option: SyncOption, enabled: boolean) {
		this[option] = enabled;
		await deviceSettings.set(enabledKeys[option], enabled);
	}
}

export const syncOptions = new SyncOptions();
