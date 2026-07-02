/*
	Remote-peer implementation of SyncSource — this device's view of one
	connected peer's ledger files (src/routes/sync/beancount/+page.svelte). See
	doc/projects/2026-07-02_beancount-peer-sync.md, "Peer Protocol".

	A single instance both answers `list-files`/`read-file`/`hash-file`
	requests from any trusted peer (backed by `localSource`, this device's own
	files) and issues those same requests against whichever peer `target()`
	currently points at — symmetric with how `list-files` already worked
	before this class existed. `writeFile`/`deleteFile` stay unimplemented
	until push ships (see the project doc's Future section).
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
interface FoundHash {
	hash: string;
	[key: string]: string;
}
type HashFileResponse = FoundHash | Missing;

/** This device's view of a connected peer's ledger files, as a SyncSource. */
export class PeerSource implements SyncSource {
	private listFilesAction: RequestAction<null, SyncEntry[]>;
	private readFileAction: RequestAction<PathRequest, ReadFileResponse>;
	private hashFileAction: RequestAction<PathRequest, HashFileResponse>;

	/**
	 * @param presence Room must already be joined (registration happens now).
	 * @param localSource This device's own files, used to answer requests from peers.
	 * @param target Returns the persistent id of the currently selected peer, or null
	 *   if none is selected — resolved to a live trystero id on every call, since the
	 *   selection can change (or the peer can go offline) after construction.
	 */
	constructor(
		private presence: PeerPresence,
		localSource: SyncSource,
		private target: () => string | null
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

		this.hashFileAction = presence.makeRequestAction<PathRequest, HashFileResponse>(
			'hash-file',
			async ({ path }, { peerId: fromId }): Promise<HashFileResponse> => {
				if (!presence.peersMap[fromId]?.isTrusted) return { missing: true };
				const hash = await localSource.hashFile(path);
				if (hash === undefined) return { missing: true };
				return { hash };
			}
		);
	}

	/** Live trystero id of the currently selected peer. Throws if none is selected or it's offline. */
	private targetTrysteroId(): string {
		const persistentId = this.target();
		if (!persistentId) throw new Error('No peer selected');
		const trysteroId = this.presence.onlineTrysteroId(persistentId);
		if (!trysteroId) throw new Error('Peer is offline');
		return trysteroId;
	}

	async listTree(): Promise<SyncEntry[]> {
		return await this.listFilesAction.request(null, {
			target: this.targetTrysteroId(),
			timeoutMs: REQUEST_TIMEOUT_MS
		});
	}

	async readFile(path: string): Promise<string | undefined> {
		const res = await this.readFileAction.request(
			{ path },
			{ target: this.targetTrysteroId(), timeoutMs: REQUEST_TIMEOUT_MS }
		);
		return 'missing' in res ? undefined : res.content;
	}

	/** Digest computed by, and requested from, the peer — never pulls file content to verify a match. */
	async hashFile(path: string): Promise<string | undefined> {
		const res = await this.hashFileAction.request(
			{ path },
			{ target: this.targetTrysteroId(), timeoutMs: REQUEST_TIMEOUT_MS }
		);
		return 'missing' in res ? undefined : res.hash;
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
