/**
 * Identity of this device and the Trusted Devices list, shared by Peer Sync, WebDAV and S3. The
 * device ID is the persistent peer ID; what a device uploads is found by it (see deltaSync.ts).
 */
import db from '#lib/data/db';
import { TrustedPeer } from '#lib/data/model';
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';

/** The documents synced between devices. */
export type DocKind = 'xacts' | 'scx';

/** This device's persistent ID (shared with peer sync), created on first use. */
export async function getDeviceId(): Promise<string> {
	let id = await deviceSettings.get<string>(DeviceSettingKeys.peerId);
	if (!id) {
		id = crypto.randomUUID();
		await deviceSettings.set(DeviceSettingKeys.peerId, id);
	}
	return id;
}

/** Add a device found in a WebDAV folder or S3 bucket to the Trusted Peers list. */
export async function trustDevice(deviceId: string, name?: string): Promise<TrustedPeer> {
	const tp = new TrustedPeer();
	tp.id = deviceId;
	tp.name = name?.trim() || `Device ${deviceId.slice(0, 6)}`;
	tp.trustedAt = new Date().toISOString();
	await db.peers.put(tp);
	return tp;
}
