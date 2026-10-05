/**
 * Discovery of other devices' Yjs state files on WebDAV, and matching them
 * against the Trusted Peers list. Each device writes only its own
 * `cashier-xacts-<deviceId>.ydoc` (working set) and `cashier-scx-<deviceId>.ydoc`
 * (scheduled transactions); the device ID is the persistent peer ID.
 */
import db from '$lib/data/db';
import { TrustedPeer } from '$lib/data/model';
import { deviceSettings, DeviceSettingKeys } from '$lib/settings';
import type { WebDavClient } from '$lib/utils/webdav';

/** The documents synced as per-device state files. */
export type DocKind = 'xacts' | 'scx';

const FILE_PATTERNS: Record<DocKind, RegExp> = {
	xacts: /^cashier-xacts-(.+)\.ydoc$/,
	scx: /^cashier-scx-(.+)\.ydoc$/
};

export type RemoteDeviceStatus = 'self' | 'trusted' | 'untrusted';

export interface RemoteDevice {
	deviceId: string;
	filename: string;
	size: number | null;
	lastModified: Date | null;
	status: RemoteDeviceStatus;
	/** Name from the Trusted Peers list, when trusted. */
	name?: string;
	/** The device's scheduled-transactions file, if it has uploaded one. */
	scx?: { filename: string; lastModified: Date | null };
}

export interface MergeState {
	/** Modification time of the device's working-set file when it was last merged. */
	remoteTs: string | null;
	mergedAt: string;
	/** Same for the scheduled-transactions file; absent until it was first merged. */
	scxTs?: string | null;
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

export function ydocFilename(deviceId: string, kind: DocKind = 'xacts'): string {
	return `cashier-${kind}-${deviceId}.ydoc`;
}

/** Device ID encoded in a Yjs state file name of the given kind, or null if it is not one. */
export function parseYdocFilename(filename: string, kind: DocKind = 'xacts'): string | null {
	return FILE_PATTERNS[kind].exec(filename)?.[1] ?? null;
}

/** All Yjs state files in the WebDAV folder, each classified against the trusted peers. */
export async function listRemoteDevices(client: WebDavClient): Promise<RemoteDevice[]> {
	const [entries, peers, selfId] = await Promise.all([
		client.list(),
		db.peers.toArray(),
		getDeviceId()
	]);
	const scxFiles = new Map<string, NonNullable<RemoteDevice['scx']>>();
	for (const e of entries) {
		const deviceId = e.isDirectory ? null : parseYdocFilename(e.name, 'scx');
		if (deviceId) scxFiles.set(deviceId, { filename: e.name, lastModified: e.lastModified });
	}
	// A device is listed by its working-set file; one with only an scx file is not.
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
			name: peer?.name,
			scx: scxFiles.get(deviceId)
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
	return (
		(await deviceSettings.get<Record<string, MergeState>>(DeviceSettingKeys.crdtMergeState)) ?? {}
	);
}

/** Records a merge; only the fields given change, so merging one kind keeps the other's state. */
export async function setMergeState(deviceId: string, state: Partial<MergeState>): Promise<void> {
	const all = await getMergeState();
	const previous: Partial<MergeState> = all[deviceId] ?? {};
	all[deviceId] = { remoteTs: null, mergedAt: new Date().toISOString(), ...previous, ...state };
	await deviceSettings.set(DeviceSettingKeys.crdtMergeState, all);
}

/** True when the remote file changed since it was last merged (or was never merged). */
export function needsMerge(
	device: RemoteDevice,
	state: MergeState | undefined,
	kind: DocKind = 'xacts'
): boolean {
	if (kind === 'scx') {
		if (!device.scx) return false;
		if (state?.scxTs === undefined) return true;
		return (device.scx.lastModified?.toISOString() ?? null) !== state.scxTs;
	}
	if (!state) return true;
	return (device.lastModified?.toISOString() ?? null) !== state.remoteTs;
}
