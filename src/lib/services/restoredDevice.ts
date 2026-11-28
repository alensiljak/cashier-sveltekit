/**
 * The device a backup was restored from.
 *
 * A restore on a clean device makes a new device: a new key, so a new ID. The backup records the ID
 * of the device it was made on, and the restore keeps it as `previousDeviceId`, the same place a
 * device keeps the UUID it had before its ID was derived from its key. So what the old device
 * uploaded (S3, WebDAV) is merged like this device's own, and the journal counts its records as own.
 *
 * What the old device left in the bucket is retired (merged, then deleted, see `DeltaSync.retire`)
 * only when a person says that device is gone: restoring a backup onto a second device while the
 * first is still in use is possible, and must not delete what the first one keeps writing.
 * Until then `previousDeviceHeld` stops the retiring.
 */
import db from '#lib/data/db';
import type { TrustedPeer } from '#lib/data/model';
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import type { DeltaState } from '#lib/sync/deltaSync';

export interface RestoredDevice {
	id: string;
}

const holdsSomething = (value: unknown): boolean =>
	!!value && Object.values(value).some((v) => !!v);

/**
 * Whether this device has ever synced, by what only a sync leaves behind (none of it is in a
 * backup). What the transaction stores hold says nothing: they may have been restored.
 */
export async function hasEverSynced(): Promise<boolean> {
	if (await deviceSettings.get<string>(DeviceSettingKeys.s3LastSync)) return true;
	for (const key of [
		DeviceSettingKeys.syncChannelLastSync,
		DeviceSettingKeys.webdavLastSyncTs,
		DeviceSettingKeys.s3SyncBase
	]) {
		if (holdsSomething(await deviceSettings.get<object>(key))) return true;
	}

	// Delta-sync progress is also saved before the first sync, to keep the changes waiting for it.
	const prefix = `${DeviceSettingKeys.deltaSyncState}:`;
	for (const { key, value } of await deviceSettings.getAllWithSecrets()) {
		if (!key.startsWith(prefix)) continue;
		const state = JSON.parse(value) as DeltaState;
		if (state.nextSeq > 1 || state.snapId || state.acked) return true;
		if (holdsSomething(state.applied) || holdsSomething(state.legacy)) return true;
	}

	// Peer Sync: the file-sync baseline, set up at pairing.
	if ((await db.peerSyncBaseline.count()) > 0) return true;
	return (await db.peers.toArray()).some((p: TrustedPeer) => !!p.fileSyncInitializedAt);
}

/** The device this one was restored from, while a person has not said what became of it. */
export async function getRestoredDevice(): Promise<RestoredDevice | null> {
	const held = await deviceSettings.get<boolean>(DeviceSettingKeys.previousDeviceHeld);
	if (!held) return null;
	const id = await deviceSettings.get<string>(DeviceSettingKeys.previousDeviceId);
	return id ? { id } : null;
}

/** Remembers `id` as the device this one replaces, and holds back retiring its files. */
export async function recordRestoredDevice(id: string): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.previousDeviceId, id);
	await deviceSettings.set(DeviceSettingKeys.previousDeviceHeld, true);
}

/**
 * The old device is lost: its files are merged and removed from the buckets at the next full sync.
 * It stays this device's `previousDeviceId` until then, so nothing it wrote is skipped.
 */
export async function markRestoredDeviceLost(): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.previousDeviceHeld, false);
}

/**
 * The old device is still in use: it is a device of its own, and has to be trusted like any other
 * (Trusted Devices, Peer Sync). Its files are left alone.
 */
export async function markRestoredDeviceInUse(): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.previousDeviceHeld, false);
	await deviceSettings.set(DeviceSettingKeys.previousDeviceId, '');
	const { resetDeltaSyncRegistry } = await import('#lib/sync/deltaSyncRegistry');
	resetDeltaSyncRegistry();
}
