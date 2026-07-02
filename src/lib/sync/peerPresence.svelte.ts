/*
	Shared trystero room-presence layer for peer sync.

	Handles device identity, room join/leave, the `hello` handshake (peer
	discovery + pairing-code computation), and trust bookkeeping. This is the
	"pure identity/pairing" surface that `peer-sync/+page.svelte` owns and that
	`sync/beancount/+page.svelte` also needs (to know which trusted peer, if
	any, is currently reachable) — kept in one place so both stay in sync
	instead of drifting apart.

	Each consumer creates its own instance (one trystero room per mounted
	page) and calls `leave()` on unmount.
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
	pairingCode: string;
	isTrusted: boolean;
}

export async function computePairingCode(id1: string, id2: string): Promise<string> {
	const combined = [id1, id2].sort().join('|');
	const buffer = new TextEncoder().encode(combined);
	const hash = await crypto.subtle.digest('SHA-256', buffer);
	const view = new DataView(hash);
	return (view.getUint32(0) % 1_000_000).toString().padStart(6, '0');
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

		this.helloAction.onMessage = async (data, { peerId: trysteroId }) => {
			const code = await computePairingCode(this.myId, data.id);
			const isTrusted = this.trustedPeers.some((p) => p.id === data.id);
			this.peersMap = {
				...this.peersMap,
				[trysteroId]: {
					trysteroId,
					persistentId: data.id,
					name: data.name,
					pairingCode: code,
					isTrusted
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
			const { [trysteroId]: _removed, ...rest } = this.peersMap;
			this.peersMap = rest;
		};

		this.isInRoom = true;
		await settings.set(SettingKeys.peerRoom, trimmed);
	}

	async leave(): Promise<void> {
		if (this.room) {
			await this.room.leave();
			this.room = null;
			this.helloAction = null;
		}
		this.peersMap = {};
		this.isInRoom = false;
	}

	async trust(peer: ActivePeer): Promise<TrustedPeer> {
		const tp = new TrustedPeer();
		tp.id = peer.persistentId;
		tp.name = peer.name;
		tp.trustedAt = new Date().toISOString();
		tp.lastSeen = new Date().toISOString();
		await db.peers.put(tp);
		this.trustedPeers = await db.peers.toArray();
		this.peersMap = { ...this.peersMap, [peer.trysteroId]: { ...peer, isTrusted: true } };
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
