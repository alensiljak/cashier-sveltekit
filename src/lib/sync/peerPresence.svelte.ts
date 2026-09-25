/*
	Shared trystero room-presence layer for peer sync.

	Handles device identity, room join/leave, the `hello` handshake (peer
	discovery + pairing-code computation), and trust bookkeeping. This is the
	"pure identity/pairing" surface consumed through the singleton in
	peerConnection.svelte.ts — both `peer-sync/+page.svelte` and
	`sync/beancount/+page.svelte` share ONE instance so the room (and its
	discovered peers) stays joined across navigation between the two pages
	instead of each page joining/leaving its own copy.

	Call `leave()` only to actually disconnect (e.g. the Connect toggle) —
	never on unmount, since the room is meant to outlive any single page.
*/
import type {
	Room,
	MessageAction,
	DataPayload,
	RequestAction,
	RequestContext,
	JoinRoom,
	JoinRoomConfig
} from '@trystero-p2p/core';
import { settings, SettingKeys, deviceSettings, DeviceSettingKeys } from '$lib/settings';
import db from '$lib/data/db';
import { TrustedPeer } from '$lib/data/model';

const APP_ID = 'cashier-peer-sync';

/**
 * Signaling network used to discover peers. All three share the exact same
 * `joinRoom`/`Room` API (trystero's whole point), so swapping is just a
 * matter of choosing which module to dynamically import — no other code in
 * this class is strategy-specific. IMPORTANT: peers only find each other if
 * BOTH sides pick the same strategy; it's a separate signaling network per
 * choice, not a fallback chain.
 */
export type RelayStrategy = 'nostr' | 'mqtt' | 'torrent';
export const RELAY_STRATEGIES: { value: RelayStrategy; label: string }[] = [
	{ value: 'nostr', label: 'Nostr (default)' },
	{ value: 'mqtt', label: 'MQTT' },
	{ value: 'torrent', label: 'BitTorrent' }
];

type StrategyModule = { joinRoom: JoinRoom<JoinRoomConfig> };
const STRATEGY_LOADERS: Record<RelayStrategy, () => Promise<StrategyModule>> = {
	nostr: () => import('@trystero-p2p/nostr'),
	mqtt: () => import('@trystero-p2p/mqtt'),
	torrent: () => import('@trystero-p2p/torrent')
};

export interface ActivePeer {
	trysteroId: string;
	persistentId: string;
	name: string;
	/** 8-digit code bound to this connection's DTLS certificates; '' when they can't be read (pairing is then refused). */
	pairingCode: string;
	isTrusted: boolean;
	/** The peer has already confirmed the code and trusted this device. */
	peerConfirmed: boolean;
}

/** First DTLS `a=fingerprint` in an SDP blob, or null. */
function sdpFingerprint(sdp: string | undefined): string | null {
	return sdp?.match(/a=fingerprint:\S+\s+([0-9A-Fa-f:]+)/)?.[1]?.toUpperCase() ?? null;
}

/** DTLS certificate fingerprints of both ends of a live peer connection. */
function connectionFingerprints(pc: RTCPeerConnection | undefined) {
	const local = sdpFingerprint(pc?.localDescription?.sdp);
	const remote = sdpFingerprint(pc?.remoteDescription?.sdp);
	return local && remote ? { local, remote } : null;
}

/**
 * Short authentication string for a pairing. Hashes both devices' IDs *and*
 * the DTLS fingerprints of the connection between them, so the code is
 * different every session and a man-in-the-middle relaying two separate
 * connections cannot make both users see the same code.
 */
export async function computePairingCode(
	self: { id: string; fingerprint: string },
	peer: { id: string; fingerprint: string }
): Promise<string> {
	const combined = [self, peer]
		.map((d) => `${d.id}|${d.fingerprint}`)
		.sort()
		.join('\n');
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combined));
	return (new DataView(hash).getUint32(0) % 100_000_000).toString().padStart(8, '0');
}

export class PeerPresence {
	myId = $state('');
	myName = $state('');
	roomCode = $state('cashier');
	strategy = $state<RelayStrategy>('nostr');
	isInRoom = $state(false);
	peersMap = $state<Record<string, ActivePeer>>({});
	trustedPeers = $state<TrustedPeer[]>([]);

	activePeerList = $derived(Object.values(this.peersMap));

	room: Room | null = null;
	private helloAction: MessageAction<{ id: string; name: string }> | null = null;
	private confirmAction: MessageAction<{ id: string }> | null = null;
	/** trysteroIds that confirmed the pairing code; kept apart from `peersMap` because the confirmation can arrive before their hello. */
	private confirmedBy = new Set<string>();
	/** Polls `room.getPeers()` so a dead RTCPeerConnection is evicted even when
	 *  `onPeerLeave` never fires — WebRTC's own disconnect detection can take
	 *  tens of seconds to minutes, which otherwise leaves a since-refreshed
	 *  peer looking "online" indefinitely. */
	private pruneTimer: number | null = null;
	private handlePageHide: (() => void) | null = null;

	/** Loads identity/room/trusted-peers from storage. Call once before `join()`. */
	async init(): Promise<void> {
		let id = await deviceSettings.get<string>(DeviceSettingKeys.peerId);
		if (!id) {
			id = crypto.randomUUID();
			await deviceSettings.set(DeviceSettingKeys.peerId, id);
		}
		this.myId = id;

		const savedName = await deviceSettings.get<string>(DeviceSettingKeys.peerName);
		this.myName = savedName ?? 'My Device';

		const savedRoom = await settings.get<string>(SettingKeys.peerRoom);
		if (savedRoom) this.roomCode = savedRoom;

		const savedStrategy = await settings.get<RelayStrategy>(SettingKeys.peerRelayStrategy);
		if (savedStrategy) this.strategy = savedStrategy;

		this.trustedPeers = await db.peers.toArray();
	}

	async setName(name: string): Promise<void> {
		this.myName = name;
		await deviceSettings.set(DeviceSettingKeys.peerName, name);
	}

	/** Persists the relay strategy. Does NOT reconnect a live room — call `leave()` then `join()` to apply it. */
	async setStrategy(strategy: RelayStrategy): Promise<void> {
		this.strategy = strategy;
		await settings.set(SettingKeys.peerRelayStrategy, strategy);
	}

	/** Registers an additional trystero action on the shared room (e.g. a sync protocol). Room must already be joined. */
	makeAction<T extends DataPayload>(name: string): MessageAction<T> {
		if (!this.room) throw new Error('Not in a room');
		const action = this.room.makeAction<any>(name);
		return action as unknown as MessageAction<T>;
	}

	/** Registers a request/response trystero action on the shared room (e.g. `list-files`). Room must already be joined. */
	makeRequestAction<T extends DataPayload, R extends DataPayload>(
		name: string,
		onRequest: (data: T, context: RequestContext) => R | Promise<R>
	): RequestAction<T, R> {
		if (!this.room) throw new Error('Not in a room');
		return this.room.makeAction<T, R>(name, { kind: 'request', onRequest });
	}

	async join(roomCode: string = this.roomCode): Promise<void> {
		const trimmed = roomCode.trim();
		if (!trimmed || this.isInRoom) return;

		const { joinRoom } = await STRATEGY_LOADERS[this.strategy]();
		this.room = joinRoom({ appId: APP_ID }, trimmed);
		this.roomCode = trimmed;

		this.helloAction = this.room.makeAction('hello') as unknown as MessageAction<{
			id: string;
			name: string;
		}>;

		this.room.onPeerJoin = (trysteroId) => {
			this.helloAction!.send({ id: this.myId, name: this.myName }, { target: trysteroId });
		};

		this.confirmAction = this.room.makeAction('pair-confirm') as unknown as MessageAction<{
			id: string;
		}>;
		this.confirmAction.onMessage = (data, { peerId: trysteroId }) => {
			this.confirmedBy.add(trysteroId);
			const peer = this.peersMap[trysteroId];
			// Ignore a confirmation whose ID doesn't match the hello we saw.
			if (peer && peer.persistentId === data.id) {
				this.peersMap = { ...this.peersMap, [trysteroId]: { ...peer, peerConfirmed: true } };
			}
		};

		this.helloAction.onMessage = async (data, { peerId: trysteroId }) => {
			const fps = connectionFingerprints(this.room?.getPeers()[trysteroId]);
			const code = fps
				? await computePairingCode(
						{ id: this.myId, fingerprint: fps.local },
						{ id: data.id, fingerprint: fps.remote }
					)
				: '';
			const isTrusted = this.trustedPeers.some((p) => p.id === data.id);
			this.peersMap = {
				...this.peersMap,
				[trysteroId]: {
					trysteroId,
					persistentId: data.id,
					name: data.name,
					pairingCode: code,
					isTrusted,
					peerConfirmed: this.confirmedBy.has(trysteroId)
				}
			};
			if (isTrusted) {
				const tp = this.trustedPeers.find((p) => p.id === data.id);
				if (tp) {
					tp.lastSeen = new Date().toISOString();
					await db.peers.put(tp);
				}
			}
		};

		this.room.onPeerLeave = (trysteroId) => {
			this.confirmedBy.delete(trysteroId);
			const { [trysteroId]: _removed, ...rest } = this.peersMap;
			this.peersMap = rest;
		};

		this.isInRoom = true;
		await settings.set(SettingKeys.peerRoom, trimmed);

		// Best-effort: lets the relay propagate an immediate leave signal on tab
		// close/refresh/navigation instead of the remaining peer waiting out
		// WebRTC's own (often 30s+) disconnect-detection timeout. Not awaited —
		// pagehide can't wait on async work.
		this.handlePageHide = () => {
			this.room?.leave();
		};
		window.addEventListener('pagehide', this.handlePageHide);

		// Self-heals the case above's counterpart doesn't fire on the OTHER
		// end (e.g. the leave signal is dropped, or the peer's process is
		// killed rather than gracefully unloaded) by evicting any peer whose
		// underlying RTCPeerConnection is no longer actually connected.
		this.pruneTimer = window.setInterval(() => this.pruneStaleConnections(), 5000);
	}

	/** Drops any `peersMap` entry whose RTCPeerConnection has gone dead without `onPeerLeave` firing. */
	private pruneStaleConnections(): void {
		if (!this.room) return;
		const live = this.room.getPeers();
		const deadStates = new Set(['disconnected', 'failed', 'closed']);
		let changed = false;
		const next = { ...this.peersMap };
		for (const trysteroId of Object.keys(next)) {
			const pc = live[trysteroId];
			if (!pc || deadStates.has(pc.connectionState)) {
				delete next[trysteroId];
				changed = true;
			}
		}
		if (changed) this.peersMap = next;
	}

	async leave(): Promise<void> {
		if (this.pruneTimer !== null) {
			window.clearInterval(this.pruneTimer);
			this.pruneTimer = null;
		}
		if (this.handlePageHide) {
			window.removeEventListener('pagehide', this.handlePageHide);
			this.handlePageHide = null;
		}
		if (this.room) {
			await this.room.leave();
			this.room = null;
			this.helloAction = null;
			this.confirmAction = null;
		}
		this.confirmedBy.clear();
		this.peersMap = {};
		this.isInRoom = false;
	}

	/** Trusts a peer after the user confirmed the pairing code, and tells the peer so its UI can show it. */
	async trust(peer: ActivePeer): Promise<TrustedPeer> {
		if (!peer.pairingCode) throw new Error('Cannot pair: connection fingerprint unavailable');
		const tp = new TrustedPeer();
		tp.id = peer.persistentId;
		tp.name = peer.name;
		tp.trustedAt = new Date().toISOString();
		tp.lastSeen = new Date().toISOString();
		await db.peers.put(tp);
		this.trustedPeers = await db.peers.toArray();
		this.peersMap = { ...this.peersMap, [peer.trysteroId]: { ...peer, isTrusted: true } };
		void this.confirmAction?.send({ id: this.myId }, { target: peer.trysteroId });
		return tp;
	}

	async removeTrust(persistentId: string): Promise<void> {
		await db.peers.delete(persistentId);
		this.trustedPeers = await db.peers.toArray();
		const updated = { ...this.peersMap };
		for (const [tid, p] of Object.entries(updated)) {
			if (p.persistentId === persistentId) updated[tid] = { ...p, isTrusted: false };
		}
		this.peersMap = updated;
	}

	/** trysteroId of a trusted peer currently visible in the room, or null if offline. */
	onlineTrysteroId(persistentId: string): string | null {
		const found = this.activePeerList.find((p) => p.persistentId === persistentId && p.isTrusted);
		return found?.trysteroId ?? null;
	}
}
