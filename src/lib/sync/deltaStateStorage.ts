import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import type { DeltaState, DeltaStateStorage } from './deltaSync';
import type { DocKind } from './ydocDevices';

/**
 * Keeps a store's delta-sync progress in the device settings (IndexedDB). It is per bucket:
 * what was applied from one bucket says nothing about another.
 */
export function deviceSettingsStateStorage(kind: DocKind, bucketId: string): DeltaStateStorage {
	const key = `${DeviceSettingKeys.deltaSyncState}:${kind}:${bucketId}`;
	return {
		load: () => deviceSettings.get<DeltaState>(key),
		save: (state) => deviceSettings.set(key, state)
	};
}
