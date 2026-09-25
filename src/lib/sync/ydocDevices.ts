/**
 * Discovery of other devices' Yjs state files on WebDAV, and matching them
 * against the Trusted Peers list. Each device writes only its own
 * `cashier-xacts-<deviceId>.ydoc`; the device ID is the persistent peer ID.
 */
import db from '$lib/data/db';
import { TrustedPeer } from '$lib/data/model';
import { deviceSettings, DeviceSettingKeys } from '$lib/settings';
import type { WebDavClient } from '$lib/utils/webdav';

const FILE_PATTERN = /^cashier-xacts-(.+)\.ydoc$/;

export type RemoteDeviceStatus = 'self' | 'trusted' | 'untrusted';

export interface RemoteDevice {
	deviceId: string;
	filename: string;
	size: number | null;
	lastModified: Date | null;
	status: RemoteDeviceStatus;
	/** Name from the Trusted Peers list, when trusted. */
	name?: string;
}

export interface MergeState {
	remoteTs: string | null;
	mergedAt: string;
}

/** This device's persistent ID (shared with peer sync), created on first use. */
export async function getDeviceId(): Promise<string> {
	let id = await deviceSettings.get<string>(DeviceSettingKeys.peerId);
	if (!id) {
		id = crypto.randomUUID();
		await deviceSettings.set(DeviceSettingKeys.peerId, id);
	}
	return id;
}

export function ydocFilename(deviceId: string): string {
	return `cashier-xacts-${deviceId}.ydoc`;
}

/** Device ID encoded in a Yjs state file name, or null if it is not one. */
export function parseYdocFilename(filename: string): string | null {
	return FILE_PATTERN.exec(filename)?.[1] ?? null;
}

/** All Yjs state files in the WebDAV folder, each classified against the trusted peers. */
export async function listRemoteDevices(client: WebDavClient): Promise<RemoteDevice[]> {
	const [entries, peers, selfId] = await Promise.all([
		client.list(),
		db.peers.toArray(),
		getDeviceId()
	]);
	const devices: RemoteDevice[] = [];
	for (const e of entries) {
		const deviceId = e.isDirectory ? null : parseYdocFilename(e.name);
		if (!deviceId) continue;
		const peer = peers.find((p) => p.id === deviceId);
		devices.push({
			deviceId,
			filename: e.name,
			size: e.size,
			lastModified: e.lastModified,
			status: deviceId === selfId ? 'self' : peer ? 'trusted' : 'untrusted',
			name: peer?.name
		});
	}
	return devices.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

/** Add a device found on WebDAV to the Trusted Peers list. */
export async function trustDevice(deviceId: string, name?: string): Promise<TrustedPeer> {
	const tp = new TrustedPeer();
	tp.id = deviceId;
	tp.name = name?.trim() || `Device ${deviceId.slice(0, 6)}`;
	tp.trustedAt = new Date().toISOString();
	await db.peers.put(tp);
	return tp;
}

export async function getMergeState(): Promise<Record<string, MergeState>> {
	return (await deviceSettings.get<Record<string, MergeState>>(DeviceSettingKeys.crdtMergeState)) ?? {};
}

export async function setMergeState(deviceId: string, state: MergeState): Promise<void> {
	const all = await getMergeState();
	all[deviceId] = state;
	await deviceSettings.set(DeviceSettingKeys.crdtMergeState, all);
}

/** True when the remote file changed since it was last merged (or was never merged). */
export function needsMerge(device: RemoteDevice, state: MergeState | undefined): boolean {
	if (!state) return true;
	return (device.lastModified?.toISOString() ?? null) !== state.remoteTs;
}
