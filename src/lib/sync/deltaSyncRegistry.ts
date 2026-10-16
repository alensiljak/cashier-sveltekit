/**
 * The delta syncs in use, one per store and remote, plus what S3 and WebDAV both need around
 * them: the trust list as the ignore rule, and the clean-up that follows a sync.
 */
import db from '#lib/data/db';
import { DeltaSync, type DeltaDoc } from './deltaSync';
import { deviceSettingsStateStorage } from './deltaStateStorage';
import type { RemoteStore } from './remoteStore';
import type { DocKind } from './ydocDevices';

/** Why another device's data is not merged here: not on the Trusted Devices list, or read-only. */
export async function loadIgnoreReasons(): Promise<(deviceId: string | null) => string | null> {
	const peers = new Map((await db.peers.toArray()).map((p) => [p.id, p]));
	return (deviceId) => {
		const peer = deviceId ? peers.get(deviceId) : undefined;
		if (!peer) return 'Device not trusted';
		return peer.readOnly ? 'Device is read-only' : null;
	};
}

/** Whether a device is on the Trusted Devices list. */
export async function loadTrusted(): Promise<(deviceId: string) => boolean> {
	const ids = new Set((await db.peers.toArray()).map((p) => p.id));
	return (deviceId) => ids.has(deviceId);
}

const registry = new Map<string, { store: object; sync: DeltaSync }>();

export interface DeltaSyncTarget {
	kind: DocKind;
	deviceId: string;
	store: DeltaDoc & object;
	remote: RemoteStore;
	/** Names the bucket or folder, so that what was applied from one is not taken for another. */
	remoteId: string;
}

/**
 * The delta sync of a store for this remote, attached to the store's changes. Created on first
 * use; later calls only refresh the transport and the trust list.
 */
export async function getDeltaSync(target: DeltaSyncTarget): Promise<DeltaSync> {
	const { kind, deviceId, store, remote, remoteId } = target;
	const id = `${kind}|${remoteId}`;
	const ignore = await loadIgnoreReasons();

	let entry = registry.get(id);
	if (entry && entry.store !== store) {
		entry.sync.dispose();
		entry = undefined;
	}
	if (!entry) {
		entry = {
			store,
			sync: new DeltaSync({
				kind,
				deviceId,
				doc: store,
				remote,
				storage: deviceSettingsStateStorage(kind, remoteId),
				ignore
			})
		};
		registry.set(id, entry);
	} else {
		entry.sync.configure({ remote, ignore });
	}
	await entry.sync.attach();
	return entry.sync;
}

/**
 * What follows an upload or download: tells the other devices what this one has applied, and
 * compacts when it is time. Never fails the sync it follows; a problem is only logged.
 */
export async function afterSync(sync: DeltaSync, { compact }: { compact: boolean }): Promise<void> {
	try {
		await sync.publishAck();
		if (compact) await sync.compactIfDue({ isActive: await loadTrusted() });
	} catch (e) {
		console.warn('[delta-sync] Clean-up failed:', e);
	}
}
