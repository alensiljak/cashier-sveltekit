/*
	Remote-peer implementation of SyncSource — this device's view of a
	connected peer's ledger files (src/routes/sync/beancount/+page.svelte). See
	doc/projects/2026-07-02_beancount-peer-sync.md, "Peer Protocol".

	Split into two classes so the peer dashboard can hold a live `PeerSource`
	per trusted peer without re-registering trystero channels per peer:

	- `PeerProtocol` registers the `list-files`/`read-file` request actions
	  ONCE per room join (backed by `localSource`, this device's own files,
	  answering requests from any trusted peer) and exposes the requester
	  side with an explicit per-call target — trystero's own `request()`
	  already takes `target` per call, so one registration serves every peer.
	- `PeerSource` is a cheap, stateless-except-for-its-id adapter around a
	  shared `PeerProtocol`, implementing `SyncSource` so the diff/apply
	  logic in the page can treat every peer uniformly (including running
	  several concurrently for the dashboard's background scans).

	`writeFile`/`deleteFile` stay unimplemented until push ships (see the
	project doc's Future section).
*/
import type { RequestAction } from '@trystero-p2p/core';
import type { PeerPresence } from './peerPresence.svelte';
import type { SyncEntry, SyncSource } from './SyncSource';

const REQUEST_TIMEOUT_MS = 10_000;

// Index signatures required so these satisfy trystero's DataPayload's
// `{ [key: string]: JsonValue }` branch (same reasoning as `SyncEntry`).
interface PathRequest {
	path: string;
	[key: string]: string;
}
interface FoundContent {
	content: string;
	[key: string]: string;
}
interface Missing {
	missing: true;
	[key: string]: boolean;
}
type ReadFileResponse = FoundContent | Missing;

/**
 * Shared, target-agnostic `list-files`/`read-file` protocol for one joined
 * room. Registration (responder side) happens once in the constructor; the
 * requester side (`listTree`/`readFile`) takes the target peer's live
 * trystero id per call, so any number of `PeerSource`s can share one
 * instance instead of each registering their own trystero actions.
 */
export class PeerProtocol {
	private listFilesAction: RequestAction<null, SyncEntry[]>;
	private readFileAction: RequestAction<PathRequest, ReadFileResponse>;

	/**
	 * @param presence Room must already be joined (registration happens now).
	 * @param localSource This device's own files, used to answer requests from peers.
	 */
	constructor(
		private presence: PeerPresence,
		localSource: SyncSource
	) {
		this.listFilesAction = presence.makeRequestAction<null, SyncEntry[]>(
			'list-files',
			async (_request, { peerId: fromId }) => {
				if (!presence.peersMap[fromId]?.isTrusted) return [];
				return await localSource.listTree();
			}
		);

		this.readFileAction = presence.makeRequestAction<PathRequest, ReadFileResponse>(
			'read-file',
			async ({ path }, { peerId: fromId }): Promise<ReadFileResponse> => {
				if (!presence.peersMap[fromId]?.isTrusted) return { missing: true };
				const content = await localSource.readFile(path);
				if (content === undefined) return { missing: true };
				return { content };
			}
		);
	}

	async listTree(targetTrysteroId: string): Promise<SyncEntry[]> {
		return await this.listFilesAction.request(null, {
			target: targetTrysteroId,
			timeoutMs: REQUEST_TIMEOUT_MS
		});
	}

	async readFile(path: string, targetTrysteroId: string): Promise<string | undefined> {
		const res = await this.readFileAction.request(
			{ path },
			{ target: targetTrysteroId, timeoutMs: REQUEST_TIMEOUT_MS }
		);
		return 'missing' in res ? undefined : res.content;
	}
}

/**
 * This device's view of one connected peer's ledger files, as a SyncSource.
 * Cheap to construct — delegates to a shared `PeerProtocol` — so the peer
 * dashboard creates one per trusted peer to scan them concurrently.
 */
export class PeerSource implements SyncSource {
	constructor(
		private presence: PeerPresence,
		private protocol: PeerProtocol,
		private persistentId: string
	) {}

	/** Live trystero id of this source's peer. Throws if it's offline. */
	private trysteroId(): string {
		const trysteroId = this.presence.onlineTrysteroId(this.persistentId);
		if (!trysteroId) throw new Error('Peer is offline');
		return trysteroId;
	}

	async listTree(): Promise<SyncEntry[]> {
		return await this.protocol.listTree(this.trysteroId());
	}

	async readFile(path: string): Promise<string | undefined> {
		return await this.protocol.readFile(path, this.trysteroId());
	}

	async writeFile(): Promise<void> {
		throw new Error(
			'PeerSource.writeFile is not implemented — push is a later phase (see project doc)'
		);
	}

	async deleteFile(): Promise<void> {
		throw new Error(
			'PeerSource.deleteFile is not implemented — push is a later phase (see project doc)'
		);
	}
}
