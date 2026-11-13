/*
	The app's Sync hub: every channel, the stored last-sync times, and a ledger reload after a merge.
	Shared by the home Sync card and the /sync page, so both show the same cached status.
*/
import { reloadLedgerFromOpfs } from '#lib/services/ledgerReload';
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { defaultChannels } from './channels';
import { SyncHub } from './syncHub.svelte';

export const syncHub = new SyncHub(defaultChannels(), {
	store: {
		load: async () =>
			(await deviceSettings.get<Record<string, string>>(DeviceSettingKeys.syncChannelLastSync)) ??
			{},
		save: (map) => deviceSettings.set(DeviceSettingKeys.syncChannelLastSync, map)
	},
	onMerged: reloadLedgerFromOpfs
});
