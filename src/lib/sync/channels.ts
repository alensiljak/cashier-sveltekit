/*
	Adapters that put each sync channel (WebDAV, S3, peer-to-peer) behind the SyncChannel
	interface, for the Sync hub and the home Sync card. They wrap the same calls the pages use:
	the work is in webdavDelta.ts, s3CrdtSync.ts and peerConnection.svelte.ts. The services are
	imported on use so that opening a page does not load them.
*/
import { describeS3Error } from '#lib/services/s3Client';
import { isS3Configured, loadS3Config } from '#lib/services/s3Config';
import { syncOptions } from '#lib/services/syncOptions.svelte';
import type { SyncChannel } from './channel';
import { peerConnection } from './peerConnection.svelte';

/** Like `Error.message`, but also makes sense of S3 client errors. */
export const describeError = (e: unknown) => (e instanceof Error ? e.message : describeS3Error(e));

const webdav: SyncChannel = {
	id: 'webdav',
	label: 'WebDAV',
	href: '/backup/webdav',
	isEnabled: () => syncOptions.webdav,
	unavailableReason: () => null,
	async check() {
		const { loadWebDavClient, checkWebDav } = await import('#lib/services/webdavSync');
		const client = await loadWebDavClient();
		if (!client) throw new Error('WebDAV is not configured');
		return (await checkWebDav(client)) ? 'differs' : 'same';
	},
	async sync() {
		const { loadWebDavClient, syncWebDav } = await import('#lib/services/webdavSync');
		const client = await loadWebDavClient();
		if (!client) throw new Error('WebDAV is not configured');
		return syncWebDav(client);
	}
};

async function loadS3() {
	const cfg = await loadS3Config();
	if (!isS3Configured(cfg)) throw new Error('S3 is not configured');
	return cfg;
}

const s3: SyncChannel = {
	id: 's3',
	label: 'S3',
	href: '/backup/s3',
	isEnabled: () => syncOptions.s3,
	unavailableReason: () => null,
	async check() {
		const { checkCrdtStores } = await import('#lib/services/s3Sync');
		return (await checkCrdtStores(await loadS3())) ? 'differs' : 'same';
	},
	async sync() {
		const { syncCrdtStores } = await import('#lib/services/s3Sync');
		const { errors, merged } = await syncCrdtStores(await loadS3());
		return { errors: errors.map((l) => l.message ?? `${l.item} ${l.path}`), merged };
	},
	async lastSync() {
		const { getLastSync } = await import('#lib/services/s3Sync');
		return getLastSync();
	}
};

/** The trusted devices currently in the room. */
const trustedPeers = () => peerConnection.presence.activePeerList.filter((p) => p.isTrusted);

const peer: SyncChannel = {
	id: 'peer',
	label: 'P2P',
	href: '/peer-sync',
	isEnabled: () => syncOptions.peer,
	unavailableReason() {
		if (!peerConnection.presence.isInRoom) return 'Peer sync is off';
		if (trustedPeers().length === 0) return 'No trusted device is online';
		return null;
	},
	async check() {
		let compared = 0;
		let differs = false;
		for (const p of trustedPeers()) {
			const [local, remote] = await Promise.all([
				peerConnection.getLocalYdocHash(),
				peerConnection.fetchRemoteYdocHash(p.trysteroId)
			]);
			if (remote === null) continue;
			compared++;
			if (local !== remote) differs = true;
		}
		if (compared === 0) throw new Error('Could not read the other devices');
		return differs ? 'differs' : 'same';
	},
	async sync() {
		let merged = false;
		for (const p of trustedPeers()) {
			merged = (await peerConnection.syncYdoc(p.trysteroId)) || merged;
		}
		return { errors: [], merged };
	}
};

/** All channels, in display order. */
export const defaultChannels = (): SyncChannel[] => [webdav, s3, peer];
