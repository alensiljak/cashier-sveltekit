import { ulid } from 'ulid';
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { stateAfterDestroy, type DeltaState, type DeltaStateStorage } from './deltaSync';
import type { DocKind } from './ydocDevices';

const epochKey = (kind: DocKind) => `${DeviceSettingKeys.deltaSyncEpoch}:${kind}`;

/**
 * Records that the local store of `kind` is being destroyed. From now on, progress saved before
 * does not count for any bucket (see `stateAfterDestroy`). One write covers them all, also a
 * bucket that has no saved progress, and progress that is saved late.
 */
export async function markStoreDestroyed(kind: DocKind): Promise<void> {
	await deviceSettings.set(epochKey(kind), ulid());
}

/**
 * Keeps a store's delta-sync progress in the device settings (IndexedDB). It is per bucket:
 * what was applied from one bucket says nothing about another.
 */
export function deviceSettingsStateStorage(kind: DocKind, bucketId: string): DeltaStateStorage {
	const key = `${DeviceSettingKeys.deltaSyncState}:${kind}:${bucketId}`;
	return {
		load: async () => {
			const saved = await deviceSettings.get<DeltaState>(key);
			const epoch = await deviceSettings.get<string>(epochKey(kind));
			return epoch && saved?.epoch !== epoch ? stateAfterDestroy(saved, epoch) : saved;
		},
		save: (state) => deviceSettings.set(key, state)
	};
}
