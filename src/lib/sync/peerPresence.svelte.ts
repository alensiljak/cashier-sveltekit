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
import { settings, SettingKeys, deviceSettings, DeviceSettingKeys } from '#lib/settings';
import db from '#lib/data/db';
import { TrustedPeer } from '#lib/data/model';
import {
	fingerprintOfKey,
	getDeviceKey,
	signHello,
	verifyHello,
	type DeviceKey
} from '#lib/sync/deviceKey';
import {
	deriveSyncPassword,
	deriveSyncRoom,
	ensureGroupSecret,
	getGroupSecret,
	setGroupSecret
} from '#lib/sync/syncGroup';

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

/**
 * Parses pasted TURN/ICE server config. Accepts a bare array of ICE server
 * objects or an object with an `iceServers` array (the shape TURN providers
 * return). Empty input means "none". Throws a readable error when invalid.
 */
export function parseIceServers(text: string): RTCIceServer[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		// Providers hand out JS object literals (bare keys, trailing commas); accept
		// those too by normalizing to JSON, without evaluating the input.
		const normalized = trimmed
			.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
			.replace(/,(\s*[}\]])/g, '$1');
		try {
			parsed = JSON.parse(normalized);
		} catch {
			throw new Error('Not valid JSON');
		}
	}
	const list = Array.isArray(parsed) ? parsed : (parsed as { iceServers?: unknown })?.iceServers;
	if (!Array.isArray(list)) throw new Error('Expected an array of ICE servers');
	for (const s of list) {
		const urls = (s as RTCIceServer)?.urls;
		if (!urls || (typeof urls !== 'string' && !Array.isArray(urls))) {
			throw new Error('Every ICE server needs "urls"');
		}
	}
	return list as RTCIceServer[];
}

export interface ActivePeer {
	trysteroId: string;
	persistentId: string;
	name: string;
	isTrusted: boolean;
	/** Base64 SPKI the peer presented; set only when its signature over this connection verified. */
	publicKey?: string;
	/** Short form of the ID derived from `publicKey` (`7KQ2-M9XA`), for people to compare. Set with `publicKey`. */
	fingerprint?: string;
	/** The hello carried a key and a signature that verify for this connection. */
	verified: boolean;
	/**
	 * Why a peer whose ID is in the trusted list is not trusted: the record has no key yet
	 * (`legacy-record`, pairing again fixes it) or its key differs from the one that was paired
	 * (`key-mismatch`, possibly an impersonator).
	 */
	trustIssue?: 'legacy-record' | 'key-mismatch';
}

/** First DTLS `a=fingerprint` in an SDP blob, or null. */
function sdpFingerprint(sdp: string | undefined): string | null {
	return sdp?.match(/a=fingerprint:\S+\s+([0-9A-Fa-f:]+)/)?.[1]?.toUpperCase() ?? null;
}

export type ConnectionFingerprints = { local: string; remote: string };

/** DTLS certificate fingerprints of both ends of a live peer connection. */
export function connectionFingerprints(
	pc: RTCPeerConnection | undefined
): ConnectionFingerprints | null {
	const local = sdpFingerprint(pc?.localDescription?.sdp);
	const remote = sdpFingerprint(pc?.remoteDescription?.sdp);
	return local && remote ? { local, remote } : null;
}

/** Joins a trystero room on the given signaling network. Both peers need the same password. */
export async function joinTrysteroRoom(opts: {
	strategy: RelayStrategy;
	roomId: string;
	password: string;
	iceServers: RTCIceServer[];
}): Promise<Room> {
	const { joinRoom } = await STRATEGY_LOADERS[opts.strategy]();
	return joinRoom(
		{ appId: APP_ID, password: opts.password, turnConfig: opts.iceServers },
		opts.roomId
	);
}

/** This device's hello for the connection with `fps`; unsigned when the fingerprints can't be read. */
export async function buildHello(
	me: { id: string; name: string },
	key: DeviceKey,
	fps: ConnectionFingerprints | null
): Promise<HelloMessage> {
	const hello: HelloMessage = { id: me.id, name: me.name, publicKey: key.publicKey };
	if (fps) {
		hello.sig = await signHello(key.privateKey, {
			id: me.id,
			name: me.name,
			signerFp: fps.local,
			receiverFp: fps.remote
		});
	}
	return hello;
}

/** `publicKey` and `sig` are missing in the hello of versions before signed hellos. */
export type HelloMessage = {
	id: string;
	name: string;
	publicKey?: string;
	sig?: string;
};

/**
 * Decides what a hello proves. Trusted means: the signature verifies for this connection *and*
 * the trusted record with that ID holds the same key. Repeating a trusted ID is not enough.
 */
export async function assessHello(
	data: HelloMessage,
	fps: ConnectionFingerprints | null,
	trustedPeers: TrustedPeer[]
): Promise<
	Pick<ActivePeer, 'isTrusted' | 'verified' | 'publicKey' | 'fingerprint' | 'trustIssue'>
> {
	// The peer signed with its own fingerprint first, ours second.
	const verified =
		!!fps &&
		typeof data.publicKey === 'string' &&
		typeof data.sig === 'string' &&
		(await verifyHello(data.publicKey, data.sig, {
			id: data.id,
			name: data.name,
			signerFp: fps.remote,
			receiverFp: fps.local
		}));
	const record = trustedPeers.find((p) => p.id === data.id);
	if (!verified) return { isTrusted: false, verified: false };

	const publicKey = data.publicKey;
	const fingerprint = await fingerprintOfKey(publicKey!);
	const shown = { verified, publicKey, fingerprint };
	if (!record) return { isTrusted: false, ...shown };
	if (!record.publicKey) return { isTrusted: false, ...shown, trustIssue: 'legacy-record' };
	if (record.publicKey !== publicKey) {
		return { isTrusted: false, ...shown, trustIssue: 'key-mismatch' };
	}
	return { isTrusted: true, ...shown };
}

export class PeerPresence {
	myId = $state('');
	myName = $state('');
	/** This device has a sync group secret, so it has a private room to join. */
	hasGroup = $state(false);
	strategy = $state<RelayStrategy>('nostr');
	/** Extra TURN/ICE servers (device-only setting); empty = direct connections and default STUN only. */
	iceServers = $state<RTCIceServer[]>([]);
	isInRoom = $state(false);
	peersMap = $state<Record<string, ActivePeer>>({});
	trustedPeers = $state<TrustedPeer[]>([]);

	activePeerList = $derived(Object.values(this.peersMap));

	room: Room | null = null;
	private helloAction: MessageAction<HelloMessage> | null = null;
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

		this.hasGroup = !!(await getGroupSecret());

		const savedStrategy = await settings.get<RelayStrategy>(SettingKeys.peerRelayStrategy);
		if (savedStrategy) this.strategy = savedStrategy;

		this.iceServers =
			(await deviceSettings.get<RTCIceServer[]>(DeviceSettingKeys.peerIceServers)) ?? [];

		await this.reloadTrustedPeers();
	}

	/** Re-reads the trusted list; it can change outside this class (WebDAV/S3 pages trust devices directly in the DB). */
	async reloadTrustedPeers(): Promise<void> {
		const peers: TrustedPeer[] = await db.peers.toArray();
		// Records paired before fingerprints were stored get theirs from the key.
		for (const tp of peers) {
			if (tp.publicKey && !tp.fingerprint) {
				tp.fingerprint = await fingerprintOfKey(tp.publicKey);
				await db.peers.put(tp);
			}
		}
		this.trustedPeers = peers;
	}

	/** Persists the TURN/ICE servers. Does NOT reconnect a live room — call `leave()` then `join()` to apply it. */
	async setIceServers(servers: RTCIceServer[]): Promise<void> {
		this.iceServers = servers;
		await deviceSettings.set(DeviceSettingKeys.peerIceServers, servers);
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

	/**
	 * Joins the group's private room: its name and signaling password come from the sync group
	 * secret, created here if this device has none yet (a group of one, which others join by invite).
	 */
	async join(): Promise<void> {
		if (this.isInRoom || this.joining) return;
		this.joining = true;
		try {
			const secret = await ensureGroupSecret();
			this.hasGroup = true;
			this.room = await joinTrysteroRoom({
				strategy: this.strategy,
				roomId: await deriveSyncRoom(secret),
				password: await deriveSyncPassword(secret),
				iceServers: $state.snapshot(this.iceServers) as RTCIceServer[]
			});
			this.attachRoom(this.room);
		} finally {
			this.joining = false;
		}
	}

	private joining = false;

	private attachRoom(room: Room): void {
		this.helloAction = room.makeAction('hello') as unknown as MessageAction<HelloMessage>;

		room.onPeerJoin = (trysteroId) => {
			void this.sendHello(trysteroId);
		};

		this.helloAction.onMessage = async (data, { peerId: trysteroId }) => {
			const fps = connectionFingerprints(this.room?.getPeers()[trysteroId]);
			const assessed = await assessHello(data, fps, this.trustedPeers);
			const isTrusted = assessed.isTrusted;
			// A trusted peer is shown under the label this device gave it, not the name it announces.
			const label = isTrusted
				? (this.trustedPeers.find((p) => p.id === data.id)?.name ?? data.name)
				: data.name;
			this.peersMap = {
				...this.peersMap,
				[trysteroId]: {
					trysteroId,
					persistentId: data.id,
					name: label,
					...assessed
				}
			};
			if (isTrusted) {
				const tp = this.trustedPeers.find((p) => p.id === data.id);
				if (tp) {
					tp.lastSeen = new Date().toISOString();
					// The peer's own name is kept next to the label this device gave it.
					tp.announcedName = data.name;
					await db.peers.put(tp);
				}
			}
		};

		room.onPeerLeave = (trysteroId) => {
			const { [trysteroId]: _removed, ...rest } = this.peersMap;
			this.peersMap = rest;
		};

		this.isInRoom = true;

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

	/** Sends this device's hello, signed for the connection to `trysteroId` (unsigned if its fingerprints can't be read). */
	private async sendHello(trysteroId: string): Promise<void> {
		try {
			const fps = connectionFingerprints(this.room?.getPeers()[trysteroId]);
			const hello = await buildHello(
				{ id: this.myId, name: this.myName },
				await getDeviceKey(),
				fps
			);
			await this.helloAction?.send(hello, { target: trysteroId });
		} catch (e) {
			console.error('Could not send hello', e);
		}
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
		}
		this.peersMap = {};
		this.isInRoom = false;
	}

	// --- pairing (see pairing.svelte.ts; this class is its host) ---

	getKey(): Promise<DeviceKey> {
		return getDeviceKey();
	}

	async ensureGroupSecret(): Promise<string> {
		const secret = await ensureGroupSecret();
		this.hasGroup = true;
		return secret;
	}

	/** Takes over another device's group secret. A live room keeps the old one until it is rejoined. */
	async adoptGroupSecret(secret: string): Promise<void> {
		await setGroupSecret(secret);
		this.hasGroup = true;
	}

	joinPairingRoom(opts: {
		strategy: RelayStrategy;
		roomId: string;
		password: string;
	}): Promise<Room> {
		return joinTrysteroRoom({
			...opts,
			iceServers: $state.snapshot(this.iceServers) as RTCIceServer[]
		});
	}

	/**
	 * Trusts a device whose identity was proven by a signed hello and which a person approved (the
	 * inviter tapped Approve, or the joiner opened the invite). Refuses a key that differs from the
	 * one already trusted under the same ID.
	 */
	async trustVerified(peer: { id: string; name: string; publicKey: string }): Promise<TrustedPeer> {
		const existing: TrustedPeer | undefined = await db.peers.get(peer.id);
		if (existing?.publicKey && existing.publicKey !== peer.publicKey) {
			throw new Error(
				'This device presents a different key than the trusted device with the same ID. Remove the trusted device first.'
			);
		}
		const sameKey = !!existing && existing.publicKey === peer.publicKey;
		const now = new Date().toISOString();
		const tp = new TrustedPeer();
		tp.id = peer.id;
		tp.name = sameKey ? existing.name : peer.name;
		tp.announcedName = peer.name;
		tp.publicKey = peer.publicKey;
		tp.fingerprint = await fingerprintOfKey(peer.publicKey);
		tp.trustedAt = sameKey ? existing.trustedAt : now;
		tp.lastSeen = now;
		tp.readOnly = existing?.readOnly;
		await db.peers.put(tp);
		this.trustedPeers = await db.peers.toArray();

		const updated = { ...this.peersMap };
		for (const [tid, p] of Object.entries(updated)) {
			if (p.persistentId === peer.id && p.publicKey === peer.publicKey) {
				updated[tid] = { ...p, isTrusted: true, trustIssue: undefined, name: tp.name };
			}
		}
		this.peersMap = updated;
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

	/** Whether the peer behind this trystero ID is a read-only peer: its data is never merged here. */
	isReadOnly(trysteroId: string): boolean {
		const persistentId = this.peersMap[trysteroId]?.persistentId;
		return this.trustedPeers.some((p) => p.id === persistentId && p.readOnly);
	}

	/**
	 * Gives a trusted peer a label of this device's own ("Anna's phone"). Names are not unique and
	 * anyone can announce any name, so this only changes what is shown here. An empty name goes back
	 * to the one the peer announced.
	 */
	async renamePeer(persistentId: string, name: string): Promise<void> {
		const tp = await db.peers.get(persistentId);
		if (!tp) return;
		tp.name = name.trim() || tp.announcedName || tp.name;
		await db.peers.put(tp);
		this.trustedPeers = await db.peers.toArray();
		const updated = { ...this.peersMap };
		for (const [tid, p] of Object.entries(updated)) {
			if (p.persistentId === persistentId && p.isTrusted) updated[tid] = { ...p, name: tp.name };
		}
		this.peersMap = updated;
	}

	async setReadOnly(persistentId: string, readOnly: boolean): Promise<void> {
		const tp = await db.peers.get(persistentId);
		if (!tp) return;
		tp.readOnly = readOnly || undefined;
		await db.peers.put(tp);
		this.trustedPeers = await db.peers.toArray();
	}

	/** trysteroId of a trusted peer currently visible in the room, or null if offline. */
	onlineTrysteroId(persistentId: string): string | null {
		const found = this.activePeerList.find((p) => p.persistentId === persistentId && p.isTrusted);
		return found?.trysteroId ?? null;
	}
}
