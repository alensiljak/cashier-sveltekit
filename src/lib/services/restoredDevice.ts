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
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';

export interface RestoredDevice {
	id: string;
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
