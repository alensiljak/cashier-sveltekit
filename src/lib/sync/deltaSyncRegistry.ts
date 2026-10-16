/**
 * The delta syncs in use, one per store and remote, plus what S3 and WebDAV both need around
 * them: the trust list as the ignore rule, the clean-up that follows a sync, and starting to
 * capture a store's changes as soon as the store opens.
 */
import db from '#lib/data/db';
import { validateRecord as validateXact } from '#lib/storage/crdtXactRecord';
import { validateRecord as validateScx } from '#lib/storage/crdtScxRecord';
import { DeltaSync, type DeltaDoc } from './deltaSync';
import { deviceSettingsStateStorage } from './deltaStateStorage';
import type { RemoteObjectInfo, RemoteStore } from './remoteStore';
import { getDeviceId, type DocKind } from './ydocDevices';

/** Why another device's data is not merged here: not on the Trusted Devices list, or read-only. */
export async function loadIgnoreReasons(): Promise<(deviceId: string | null) => string | null> {
	const peers = new Map((await db.peers.toArray()).map((p) => [p.id, p]));
	return (deviceId) => {
		const peer = deviceId ? peers.get(deviceId) : undefined;
		if (!peer) return 'Device not trusted';
		return peer.readOnly ? 'Device is read-only' : null;
	};
}

/** The IDs of the devices on the Trusted Devices list. */
export async function loadTrustedIds(): Promise<string[]> {
	return (await db.peers.toArray()).map((p) => p.id);
}

/** Whether a device is on the Trusted Devices list. */
export async function loadTrusted(): Promise<(deviceId: string) => boolean> {
	const ids = new Set(await loadTrustedIds());
	return (deviceId) => ids.has(deviceId);
}

/** Names the S3 bucket (and folder in it) in the saved sync progress. */
export const s3RemoteId = (cfg: { endpoint: string; bucket: string; prefix: string }) =>
	`${cfg.endpoint}|${cfg.bucket}|${cfg.prefix}`;

/** Names the WebDAV folder in the saved sync progress. `url` as configured. */
export const webDavRemoteId = (url: string) => `webdav|${url.endsWith('/') ? url : url + '/'}`;

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
				ignore,
				validate: kind === 'xacts' ? validateXact : validateScx
			})
		};
		registry.set(id, entry);
	} else {
		entry.sync.configure({ remote, ignore });
	}
	await entry.sync.attach();
	return entry.sync;
}

/** A transport that is not connected yet: capturing changes needs none, syncing does. */
const notConnected: RemoteStore = {
	list: async (): Promise<RemoteObjectInfo[]> => {
		throw new Error('Not connected');
	},
	get: async () => {
		throw new Error('Not connected');
	},
	put: async () => {
		throw new Error('Not connected');
	},
	delete: async () => {
		throw new Error('Not connected');
	}
};

/**
 * Starts capturing a store's changes for the remotes that are in use on this device, right when
 * the store opens, so that the next upload sends just those changes. Without it, changes made
 * before the first sync of a session are only found at upload time, and sent together with the
 * whole delete set. Needs no passphrase and no network. Failures are only logged.
 */
export async function attachConfiguredRemotes(
	kind: DocKind,
	store: DeltaDoc & object
): Promise<void> {
	try {
		const { isSyncOptionEnabled } = await import('#lib/services/syncOptions.svelte');
		const deviceId = await getDeviceId();
		const remoteIds: string[] = [];

		if (await isSyncOptionEnabled('s3')) {
			const { loadS3Config, isS3Configured } = await import('#lib/services/s3Config');
			const cfg = await loadS3Config();
			if (isS3Configured(cfg)) remoteIds.push(s3RemoteId(cfg));
		}
		if (await isSyncOptionEnabled('webdav')) {
			const { settings, SettingKeys } = await import('#lib/settings');
			const cfg = await settings.get<{ url?: string }>(SettingKeys.webdavSettings);
			if (cfg?.url) remoteIds.push(webDavRemoteId(cfg.url));
		}

		for (const remoteId of remoteIds) {
			await getDeltaSync({ kind, deviceId, store, remote: notConnected, remoteId });
		}
	} catch (e) {
		console.warn('[delta-sync] Could not start capturing changes:', e);
	}
}

/**
 * What follows an upload or download: tells the other devices what this one has applied, and,
 * when `compact` is set, compacts when it is time, removes legacy files that are no longer needed
 * and resets a document that was emptied once everybody has synced the deletions. Never fails the
 * sync it follows; a problem is only logged.
 */
export async function afterSync(sync: DeltaSync, { compact }: { compact: boolean }): Promise<void> {
	try {
		await sync.publishAck();
		if (!compact) return;
		await sync.compactIfDue({ isActive: await loadTrusted() });
		await sync.cleanLegacy();
		await sync.resetIfDue({ trusted: await loadTrustedIds() });
	} catch (e) {
		console.warn('[delta-sync] Clean-up failed:', e);
	}
}
