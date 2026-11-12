/**
 * Identity of this device and the Trusted Devices list, shared by Peer Sync, WebDAV and S3. The
 * device ID is the persistent peer ID; what a device uploads is found by it (see deltaSync.ts).
 */
import db from '#lib/data/db';
import { TrustedPeer } from '#lib/data/model';
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { deviceIdFromPublicKey, fingerprintOfKey, getDeviceKey } from '#lib/sync/deviceKey';

/** The documents synced between devices. */
export type DocKind = 'xacts' | 'scx';

/**
 * This device's persistent ID (shared with peer sync, S3 and WebDAV). A new device derives it from
 * its key at first use. A device that has a legacy UUID keeps it until `switchDeviceIdIfReady`
 * (deviceIdSwitch.ts) moves it to the derived one.
 */
export async function getDeviceId(): Promise<string> {
	let id = await deviceSettings.get<string>(DeviceSettingKeys.peerId);
	if (!id) {
		id = await deviceIdFromPublicKey((await getDeviceKey()).publicKey);
		await deviceSettings.set(DeviceSettingKeys.peerId, id);
	}
	return id;
}

/**
 * Add a device found in a WebDAV folder or S3 bucket to the Trusted Peers list. Pass the key from
 * its device record (see deviceRecords.ts) when it has one: the record then holds the key and
 * fingerprint, as one paired by invite does. A key that does not hash to the ID is refused.
 */
export async function trustDevice(
	deviceId: string,
	name?: string,
	publicKey?: string
): Promise<TrustedPeer> {
	const tp = new TrustedPeer();
	tp.id = deviceId;
	tp.name = name?.trim() || `Device ${deviceId.slice(0, 6)}`;
	tp.trustedAt = new Date().toISOString();
	if (publicKey) {
		if ((await deviceIdFromPublicKey(publicKey)) !== deviceId) {
			throw new Error('The key does not belong to this device ID.');
		}
		tp.publicKey = publicKey;
		tp.fingerprint = await fingerprintOfKey(publicKey);
	}
	await db.peers.put(tp);
	return tp;
}
