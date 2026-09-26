/*
	Singleton peer-sync connection shared across the whole app.

	Wraps one `PeerPresence` (room join/leave, identity, trust) plus the three
	protocols built on top of it:
	  - the quick key/value sync (settings/scheduled) used by
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
import { settings, deviceSettings, DeviceSettingKeys } from '$lib/settings';
import db from '$lib/data/db';
import { PeerPresence, type RelayStrategy } from './peerPresence.svelte';
import { PeerProtocol } from './PeerSource';
import { OpfsSource } from './OpfsSource';
import { normalizeEol } from './SyncSource';
import { getXactStore } from '$lib/storage/xactStoreRegistry';
import type { CrdtXactStore } from '$lib/storage/crdtXactStore';
import type { MessageAction, RequestAction } from '@trystero-p2p/core';

const REQUEST_TIMEOUT_MS = 30_000;
const HASH_TIMEOUT_MS = 10_000;

export interface RemoteData {
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
	settings: string | null;
	scheduled: string | null;
	[key: string]: string | null;
}

type SyncRequestMsg = { requestId: string; files: string[] };
// Index signature required so the type satisfies DataPayload's { [key: string]: JsonValue } branch
type SyncResponseMsg = {
	requestId: string;
	settings: string | null;
	scheduled: string | null;
	[key: string]: string | null;
};

/** The CRDT transaction store, or null when this device uses another store. */
async function getCrdtStore(): Promise<CrdtXactStore | null> {
	const store = await getXactStore();
	return store.kind === 'crdt' ? (store as CrdtXactStore) : null;
}

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
	private ydocHashAction: RequestAction<null, string> | null = null;
	private ydocSyncAction: RequestAction<Uint8Array, Uint8Array> | null = null;
	private ydocUpdateAction: MessageAction<Uint8Array> | null = null;
	private stopLiveSyncFn: (() => void) | null = null;
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
					return { settings: null, scheduled: null };
				}
				return await getLocalHashes(files);
			}
		);

		// Local Transactions (CRDT store). Payloads are binary Yjs updates; an
		// empty result means "not available" (untrusted requester, or this
		// device doesn't use the CRDT store).
		this.ydocHashAction = this.presence.makeRequestAction<null, string>(
			'ydoc-hash',
			async (_request, { peerId: fromId }) => {
				if (!this.presence.peersMap[fromId]?.isTrusted) return '';
				return (await (await getCrdtStore())?.contentHash()) ?? '';
			}
		);

		// The requester sends its full state; we merge it and answer with what it lacks.
		this.ydocSyncAction = this.presence.makeRequestAction<Uint8Array, Uint8Array>(
			'ydoc-sync',
			async (remoteState, { peerId: fromId }) => {
				const store = await getCrdtStore();
				if (!store || !this.presence.peersMap[fromId]?.isTrusted) return new Uint8Array(0);
				const diff = await store.mergeAndDiff(remoteState);
				void this.reloadAfterMerge();
				return diff;
			}
		);

		// Live sync: local edits are pushed to every online trusted peer, and
		// pushed updates are merged as they arrive.
		this.ydocUpdateAction = this.presence.makeAction<Uint8Array>('ydoc-update');
		this.ydocUpdateAction.onMessage = async (update, { peerId: fromId }) => {
			const store = await getCrdtStore();
			if (!store || !this.presence.peersMap[fromId]?.isTrusted) return;
			await store.importState(update);
			void this.reloadAfterMerge();
		};
		void this.startLiveSync();

		// Resolve pending fetchRemoteData() promises.
		this.syncResponseAction.onMessage = ({ requestId, settings: s, scheduled }) => {
			const pending = this.pendingRequests.get(requestId);
			if (pending) {
				pending.resolve({ settings: s, scheduled });
				this.pendingRequests.delete(requestId);
			}
		};

		this.protocol = new PeerProtocol(this.presence, new OpfsSource());
	}

	/**
	 * A merge may have added records the loaded ledgers don't know yet. Reloads
	 * both the worker ledger and the device-journal ledger (whose version store
	 * drives the Journal page and Journal card), unless auto-reload is off.
	 */
	private async reloadAfterMerge(): Promise<void> {
		try {
			const autoReload =
				(await deviceSettings.get<boolean>(DeviceSettingKeys.peerAutoReload)) ?? true;
			if (!autoReload) return;
			const [{ reloadLedgerFromOpfs }, { default: ledgerService }] = await Promise.all([
				import('$lib/services/ledgerReload'),
				import('$lib/services/ledgerService')
			]);
			await Promise.all([reloadLedgerFromOpfs(), ledgerService.invalidate()]);
		} catch (e) {
			console.error('Reload after peer merge failed', e);
		}
	}

	/** Broadcasts local (non-remote) CRDT updates to online trusted peers while connected. */
	private async startLiveSync(): Promise<void> {
		const store = await getCrdtStore();
		if (!store || !this.ydocUpdateAction) return;
		this.stopLiveSync();
		const handler = (update: Uint8Array, origin: unknown) => {
			// Local edits have no origin; remote merges and IndexedDB loads carry one.
			if (origin !== null && origin !== undefined) return;
			for (const peer of this.presence.activePeerList) {
				if (!peer.isTrusted) continue;
				void this.ydocUpdateAction?.send(update, { target: peer.trysteroId });
			}
		};
		store.doc.on('update', handler);
		this.stopLiveSyncFn = () => store.doc.off('update', handler);
	}

	private stopLiveSync(): void {
		this.stopLiveSyncFn?.();
		this.stopLiveSyncFn = null;
	}

	async disconnect(): Promise<void> {
		this.stopLiveSync();
		this.ydocUpdateAction = null;
		await this.presence.leave();
		this.syncRequestAction = null;
		this.syncResponseAction = null;
		this.hashAction = null;
		this.ydocHashAction = null;
		this.ydocSyncAction = null;
		this.protocol = null;
		for (const { reject } of this.pendingRequests.values()) {
			reject(new Error('Disconnected'));
		}
		this.pendingRequests.clear();
	}

	/** Forces rediscovery by leaving and rejoining the same room. Trystero's
	 *  peer announce only fires once per relay subscription, so a peer whose
	 *  join was missed (relay race/drop) stays invisible until one side
	 *  resubscribes — this is the same recovery a page refresh gives, without
	 *  the reload. No-op if not currently connected. */
	async rescan(): Promise<void> {
		if (!this.presence.isInRoom) return;
		const code = this.presence.roomCode;
		await this.disconnect();
		await this.connect(code);
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

	/** Content hash of a peer's Local Transactions, or `null` if it has none to compare. */
	async fetchRemoteYdocHash(targetTrysteroId: string): Promise<string | null> {
		if (!this.ydocHashAction) throw new Error('Not connected');
		const hash = await this.ydocHashAction.request(null, {
			target: targetTrysteroId,
			timeoutMs: HASH_TIMEOUT_MS
		});
		return hash || null;
	}

	/** Content hash of this device's Local Transactions, or `null` if it doesn't use the CRDT store. */
	async getLocalYdocHash(): Promise<string | null> {
		return (await (await getCrdtStore())?.contentHash()) ?? null;
	}

	/**
	 * Two-way merges Local Transactions with a trusted, online peer: sends this
	 * device's state, applies the updates the peer sends back. Returns whether
	 * this device received anything new. Idempotent, so safe to repeat.
	 */
	async syncYdoc(targetTrysteroId: string): Promise<boolean> {
		const store = await getCrdtStore();
		if (!store) throw new Error('This device does not use the CRDT transaction store');
		if (!this.ydocSyncAction) throw new Error('Not connected');
		const before = await store.contentHash();
		const diff = await this.ydocSyncAction.request(await store.exportState(), {
			target: targetTrysteroId,
			timeoutMs: REQUEST_TIMEOUT_MS
		});
		if (diff.length === 0) {
			throw new Error('Peer refused the sync (not trusted, or not using the CRDT store)');
		}
		await store.importState(diff);
		return (await store.contentHash()) !== before;
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
