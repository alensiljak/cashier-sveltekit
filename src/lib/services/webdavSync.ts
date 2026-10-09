/**
 * Headless check and full sync of the CRDT stores (working set, scheduled transactions) with a
 * WebDAV folder, for the home-screen Sync card. The /backup/webdav page does the same with more
 * options and reporting.
 */
import { settings, SettingKeys } from '#lib/settings';
import { WebDavClient } from '#lib/utils/webdav';
import { getXactStore } from '#lib/storage/xactStoreRegistry';
import { getScxStore } from '#lib/storage/scxStoreRegistry';
import {
	getDeviceId,
	getMergeState,
	listRemoteDevices,
	needsMerge,
	setMergeState,
	type DocKind
} from '#lib/sync/ydocDevices';
import { hasNewOps } from '#lib/sync/ydocCompare';
import { uploadCrdtState, type WebDavSettings } from './webdavAutoBackupService';

export async function loadWebDavClient(): Promise<WebDavClient | null> {
	const cfg = await settings.get<WebDavSettings>(SettingKeys.webdavSettings);
	return cfg?.url ? new WebDavClient(cfg.url, cfg.username, cfg.password) : null;
}

async function storeFor(kind: DocKind) {
	const store = kind === 'xacts' ? await getXactStore() : await getScxStore();
	// Never create the scheduled-transactions store from here (see webdavAutoBackupService).
	return kind === 'scx' && !(await store.isInitialized()) ? null : store;
}

/** True when the folder and this device differ: unmerged trusted files, or an outdated own file. */
export async function checkWebDav(client: WebDavClient): Promise<boolean> {
	const [devices, mergeState, selfId] = await Promise.all([
		listRemoteDevices(client),
		getMergeState(),
		getDeviceId()
	]);
	if (
		devices.some(
			(d) =>
				d.status === 'trusted' &&
				!d.readOnly &&
				(needsMerge(d, mergeState[d.deviceId]) || needsMerge(d, mergeState[d.deviceId], 'scx'))
		)
	) {
		return true;
	}

	// This device's own files against the local state.
	const own = devices.find((d) => d.deviceId === selfId);
	for (const kind of ['xacts', 'scx'] as DocKind[]) {
		const store = await storeFor(kind);
		if (!store) continue;
		const local = await store.exportState();
		const filename = kind === 'xacts' ? own?.filename : own?.scx?.filename;
		if (!filename) {
			if (hasNewOps(local)) return true;
			continue;
		}
		const res = await client.get(filename);
		if (!res.ok) throw new Error(`${filename}: ${res.status} ${res.statusText}`);
		if (hasNewOps(local, new Uint8Array(await res.arrayBuffer()))) return true;
	}
	return false;
}

/**
 * Merges the trusted devices' changed files, then uploads this device's state.
 * Returns the error messages and whether working-set records were merged in.
 */
export async function syncWebDav(
	client: WebDavClient
): Promise<{ errors: string[]; merged: boolean }> {
	const errors: string[] = [];
	let merged = false;
	const [devices, mergeState] = await Promise.all([listRemoteDevices(client), getMergeState()]);

	for (const d of devices) {
		if (d.status !== 'trusted' || d.readOnly) continue;
		const who = d.name ?? d.deviceId;
		try {
			if (needsMerge(d, mergeState[d.deviceId])) {
				const res = await client.get(d.filename);
				if (!res.ok) throw new Error(`${d.filename}: ${res.status} ${res.statusText}`);
				await (await getXactStore()).importState(new Uint8Array(await res.arrayBuffer()));
				await setMergeState(d.deviceId, {
					remoteTs: d.lastModified?.toISOString() ?? null,
					mergedAt: new Date().toISOString()
				});
				merged = true;
			}
			if (d.scx && needsMerge(d, mergeState[d.deviceId], 'scx')) {
				const store = await storeFor('scx');
				if (store) {
					const res = await client.get(d.scx.filename);
					if (!res.ok) throw new Error(`${d.scx.filename}: ${res.status} ${res.statusText}`);
					await store.importState(new Uint8Array(await res.arrayBuffer()));
					await setMergeState(d.deviceId, {
						scxTs: d.scx.lastModified?.toISOString() ?? null,
						mergedAt: new Date().toISOString()
					});
				}
			}
		} catch (err) {
			errors.push(`${who}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	errors.push(...(await uploadCrdtState(client)));
	return { errors, merged };
}
