/*
	Adapters that put each sync channel (WebDAV, S3, peer-to-peer) behind the SyncChannel
	interface, for the Sync hub and the home Sync card. They wrap the same calls the pages use:
	the work is in webdavDelta.ts, s3CrdtSync.ts and peerConnection.svelte.ts. The services are
	imported on use so that opening a page does not load them.
*/
import { describeS3Error } from '#lib/services/s3Client';
import { isS3Configured, loadS3Config } from '#lib/services/s3Config';
import { syncOptions } from '#lib/services/syncOptions.svelte';
import type { ActivePeer } from './peerPresence.svelte';
import type { FileCounts, Pending, PeerDetail, SyncChannel } from './channel';
import { peerConnection } from './peerConnection.svelte';

/** Like `Error.message`, but also makes sense of S3 client errors. */
export const describeError = (e: unknown) => (e instanceof Error ? e.message : describeS3Error(e));

const webdav: SyncChannel = {
	id: 'webdav',
	label: 'WebDAV',
	href: '/sync/webdav',
	isEnabled: () => syncOptions.webdav,
	unavailableReason: () => null,
	async check() {
		const { loadWebDavClient, pendingWebDav } = await import('#lib/services/webdavSync');
		const client = await loadWebDavClient();
		if (!client) throw new Error('WebDAV is not configured');
		const pending = await pendingWebDav(client);
		return { status: pending.upload || pending.download ? 'differs' : 'same', pending };
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
	href: '/sync/s3',
	isEnabled: () => syncOptions.s3,
	unavailableReason: () => null,
	async check() {
		const { pendingCrdtStores } = await import('#lib/services/s3CrdtSync');
		const { fetchFileSyncStatus } = await import('#lib/services/s3FileCompare');
		const cfg = await loadS3();
		const [crdt, overview] = await Promise.all([pendingCrdtStores(cfg), fetchFileSyncStatus(cfg)]);
		// Settings are a file too, so they count with the Beancount files.
		const { settings, beancount } = overview;
		const files: FileCounts = {
			upload: settings.upload + beancount.upload,
			download: settings.download + beancount.download,
			conflict: settings.conflict + beancount.conflict
		};
		const pending: Pending = {
			upload: crdt.upload || files.upload > 0,
			download: crdt.download || files.download > 0,
			files
		};
		const differs = pending.upload || pending.download || files.conflict > 0;
		return { status: differs ? 'differs' : 'same', pending };
	},
	async sync() {
		const { syncCrdtStores } = await import('#lib/services/s3CrdtSync');
		const { errors, merged } = await syncCrdtStores(await loadS3());
		return { errors: errors.map((l) => l.message ?? `${l.item} ${l.path}`), merged };
	},
	async lastSync() {
		const { getLastSync } = await import('#lib/services/s3Session');
		return getLastSync();
	}
};

/** The trusted devices currently in the room. */
const trustedPeers = () => peerConnection.presence.activePeerList.filter((p) => p.isTrusted);

/**
 * How many Beancount files a pull from this peer would change, judged as /sync/beancount does it
 * (content hashes against the baseline of the last sync with that peer). Null if it cannot be read.
 */
async function peerFileCounts(p: ActivePeer): Promise<PeerDetail['files'] | null> {
	const protocol = peerConnection.protocol;
	if (!protocol) return null;
	const [
		{ OpfsSource },
		{ PeerSource },
		{ getBaseline },
		{ diffAgainstBaseline },
		{ countPeerDiffs }
	] = await Promise.all([
		import('./OpfsSource'),
		import('./PeerSource'),
		import('./syncBaseline'),
		import('./syncDiff'),
		import('./syncTree')
	]);
	const source = new PeerSource(peerConnection.presence, protocol, p.persistentId);
	const [local, remote, baseline] = await Promise.all([
		new OpfsSource().listTree(),
		source.listTree(),
		getBaseline(p.persistentId)
	]);
	return countPeerDiffs(diffAgainstBaseline(local, remote, baseline), new Map());
}

const peer: SyncChannel = {
	id: 'peer',
	label: 'P2P',
	href: '/sync/peer',
	isEnabled: () => syncOptions.peer,
	unavailableReason() {
		if (!peerConnection.presence.isInRoom) return 'Peer sync is off';
		if (trustedPeers().length === 0) return 'No trusted device is online';
		return null;
	},
	async check() {
		const local = await peerConnection.getLocalYdocHash();
		const peers: PeerDetail[] = await Promise.all(
			trustedPeers().map(async (p) => {
				const remote = await peerConnection.fetchRemoteYdocHash(p.trysteroId).catch(() => null);
				const files = (await peerFileCounts(p).catch(() => null)) ?? undefined;
				const filesDiffer = !!files && files.pull + files.conflict > 0;
				// Unknown only when neither the records nor the files could be read.
				let status: PeerDetail['status'] = 'differs';
				if (!filesDiffer && remote === null) status = 'unknown';
				else if (!filesDiffer && remote === local) status = 'same';
				return {
					id: p.trysteroId,
					persistentId: p.persistentId,
					name: p.name || 'Unnamed device',
					status,
					files
				};
			})
		);
		if (peers.every((p) => p.status === 'unknown'))
			throw new Error('Could not read the other devices');
		return { status: peers.some((p) => p.status === 'differs') ? 'differs' : 'same', peers };
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
