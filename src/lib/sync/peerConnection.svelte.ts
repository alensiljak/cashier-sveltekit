/*
	Singleton peer-sync connection shared across the whole app.

	Wraps one `PeerPresence` (room join/leave, identity, trust) plus the three
	protocols built on top of it:
	  - the quick key/value sync (cashier.bean/settings/scheduled) used by
	    peer-sync/+page.svelte's Preview/Diff/Pull actions
	  - the cheap hash-only variant of the above (`sync-hash`), used by
	    peer-sync/+page.svelte to show a same/different pill per item as soon
	    as a peer is selected, without transferring full file content
	  - the full ledger file protocol (list-files/read-file) used by
	    sync/beancount/+page.svelte

	Both protocols answer requests from any trusted peer regardless of which
	page is currently open, and the room stays joined across navigation —
	only an explicit `disconnect()` (the Peer Sync page's Connect toggle) or
	leaving the app tears it down. Pages consume the exported `peerConnection`
	singleton instead of owning their own `PeerPresence`, so switching pages
	never drops the room or re-triggers the `hello` handshake.
*/
import { settings } from '$lib/settings';
import db from '$lib/data/db';
import { readFile } from '$lib/utils/opfslib';
import { PeerPresence, type RelayStrategy } from './peerPresence.svelte';
import { PeerProtocol } from './PeerSource';
import { OpfsSource } from './OpfsSource';
import { normalizeEol } from './SyncSource';
import type { MessageAction, RequestAction } from '@trystero-p2p/core';

const REQUEST_TIMEOUT_MS = 30_000;
const HASH_TIMEOUT_MS = 10_000;

export interface RemoteData {
	bean: string | null;
	settings: string | null;
	scheduled: string | null;
}

/**
 * SHA-256 digest (hex) of each requested item's own content, keyed the same
 * way as `RemoteData` — used to show whether an item differs from a peer's
 * copy without transferring the content itself. `null` = item not requested
 * or (on the responder side) the requester isn't trusted.
 */
export interface RemoteHashes {
	bean: string | null;
	settings: string | null;
	scheduled: string | null;
	[key: string]: string | null;
}

type SyncRequestMsg = { requestId: string; files: string[] };
// Index signature required so the type satisfies DataPayload's { [key: string]: JsonValue } branch
type SyncResponseMsg = {
	requestId: string;
	bean: string | null;
	settings: string | null;
	scheduled: string | null;
	[key: string]: string | null;
};

async function hashText(content: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(normalizeEol(content))
	);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export async function getLocalData(files: string[]): Promise<RemoteData> {
	return {
		bean: files.includes('bean') ? ((await readFile('cashier.bean')) ?? '') : null,
		settings: files.includes('settings') ? JSON.stringify(await settings.getAll(), null, 2) : null,
		scheduled: files.includes('scheduled')
			? JSON.stringify(await db.scheduled.toArray(), null, 2)
			: null
	};
}

/** Hashes of this device's own `files` — same shape as `getLocalData`, digest instead of content. */
export async function getLocalHashes(files: string[]): Promise<RemoteHashes> {
	const data = await getLocalData(files);
	return {
		bean: data.bean !== null ? await hashText(data.bean) : null,
		settings: data.settings !== null ? await hashText(data.settings) : null,
		scheduled: data.scheduled !== null ? await hashText(data.scheduled) : null
	};
}

class PeerConnection {
	readonly presence = new PeerPresence();
	protocol = $state<PeerProtocol | null>(null);

	private initialized = false;
	private syncRequestAction: MessageAction<SyncRequestMsg> | null = null;
	private syncResponseAction: MessageAction<SyncResponseMsg> | null = null;
	private hashAction: RequestAction<string[], RemoteHashes> | null = null;
	private pendingRequests = new Map<
		string,
		{ resolve: (d: RemoteData) => void; reject: (e: Error) => void }
	>();

	/** Loads identity/room/trusted-peers from storage. Safe to call from every
	 *  page's `onMount` — only runs once for the lifetime of the app. */
	async ensureInit(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		await this.presence.init();
	}

	/** Joins the room (if not already joined) and registers both protocols. No-op if already connected. */
	async connect(roomCode: string = this.presence.roomCode): Promise<void> {
		await this.ensureInit();
		if (this.presence.isInRoom) return;
		await this.presence.join(roomCode);

		this.syncRequestAction = this.presence.makeAction<SyncRequestMsg>('sync-request');
		this.syncResponseAction = this.presence.makeAction<SyncResponseMsg>('sync-response');

		// Respond to quick-sync requests from trusted peers.
		this.syncRequestAction.onMessage = async ({ requestId, files }, { peerId: fromId }) => {
			if (!this.presence.peersMap[fromId]?.isTrusted) return;
			const data = await getLocalData(files);
			this.syncResponseAction!.send({ requestId, ...data }, { target: fromId });
		};

		// Cheap hash-only counterpart — lets a peer's item statuses be shown
		// as soon as it's selected, without transferring full content.
		this.hashAction = this.presence.makeRequestAction<string[], RemoteHashes>(
			'sync-hash',
			async (files, { peerId: fromId }) => {
				if (!this.presence.peersMap[fromId]?.isTrusted) {
					return { bean: null, settings: null, scheduled: null };
				}
				return await getLocalHashes(files);
			}
		);

		// Resolve pending fetchRemoteData() promises.
		this.syncResponseAction.onMessage = ({ requestId, bean, settings: s, scheduled }) => {
			const pending = this.pendingRequests.get(requestId);
			if (pending) {
				pending.resolve({ bean, settings: s, scheduled });
				this.pendingRequests.delete(requestId);
			}
		};

		this.protocol = new PeerProtocol(this.presence, new OpfsSource());
	}

	async disconnect(): Promise<void> {
		await this.presence.leave();
		this.syncRequestAction = null;
		this.syncResponseAction = null;
		this.hashAction = null;
		this.protocol = null;
		for (const { reject } of this.pendingRequests.values()) {
			reject(new Error('Disconnected'));
		}
		this.pendingRequests.clear();
	}

	/** Reconnects with a different relay strategy (see PeerPresence.setStrategy). */
	async setStrategy(value: RelayStrategy): Promise<void> {
		if (this.presence.strategy === value) return;
		const wasConnected = this.presence.isInRoom;
		if (wasConnected) await this.disconnect();
		await this.presence.setStrategy(value);
		if (wasConnected) await this.connect();
	}

	/** Requests content hashes (not content) for `files` from a trusted, currently-online peer — cheap way to show whether an item differs before fetching it via `fetchRemoteData`. */
	fetchRemoteHashes(targetTrysteroId: string, files: string[]): Promise<RemoteHashes> {
		if (!this.hashAction) return Promise.reject(new Error('Not connected'));
		return this.hashAction.request(files, { target: targetTrysteroId, timeoutMs: HASH_TIMEOUT_MS });
	}

	/** Requests `files` from a trusted, currently-online peer via the quick sync-request/response protocol. */
	fetchRemoteData(targetTrysteroId: string, files: string[]): Promise<RemoteData> {
		if (!this.syncRequestAction) return Promise.reject(new Error('Not connected'));
		const { promise, resolve, reject } = Promise.withResolvers<RemoteData>();
		const requestId = crypto.randomUUID();
		this.pendingRequests.set(requestId, { resolve, reject });
		this.syncRequestAction.send({ requestId, files }, { target: targetTrysteroId });
		setTimeout(() => {
			if (this.pendingRequests.has(requestId)) {
				this.pendingRequests.delete(requestId);
				reject(new Error('Request timed out after 30s'));
			}
		}, REQUEST_TIMEOUT_MS);
		return promise;
	}
}

/** Single shared instance — the room stays joined across page navigation. */
export const peerConnection = new PeerConnection();
