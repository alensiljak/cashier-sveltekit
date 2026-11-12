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
import {
	TrustedPeer,
	type PendingIntroduction,
	type Revocation,
	type RevocationRecord
} from '#lib/data/model';
import { introductionsFor, receiveIntroductions, type Introduction } from '#lib/sync/introductions';
import {
	acceptRevocations,
	applyRevocation,
	clearTombstones,
	evictedIds,
	onRevocationsApplied,
	recordsToShare,
	signRevocation,
	type AcceptedRevocation
} from '#lib/sync/revocations';
import {
	deviceIdFromPublicKey,
	fingerprintOfKey,
	getDeviceKey,
	signHello,
	verifyHello,
	type DeviceKey
} from '#lib/sync/deviceKey';
import { matchLegacy, peerOf, replaceTrustedRecord } from '#lib/sync/identityMigration';
import { isDerivedId } from '#lib/sync/signedObjects';
import { getDeviceId } from '#lib/sync/ydocDevices';
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
	/**
	 * This device has a key-derived ID and replaces a trusted record: `rekey` (same key; done without
	 * asking) or `approve` (a key-less record it names as its previous ID; a person confirms).
	 * `from` is the ID of that record. See identityMigration.ts.
	 */
	migration?: { kind: 'rekey' | 'approve'; from: string };
	/** Its key verified, but it was evicted from the group (see revocations.ts): never trusted unless a person pairs with it again. */
	evicted?: boolean;
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
	me: { id: string; name: string; previousId?: string },
	key: DeviceKey,
	fps: ConnectionFingerprints | null
): Promise<HelloMessage> {
	const hello: HelloMessage = { id: me.id, name: me.name, publicKey: key.publicKey };
	if (me.previousId) hello.previousId = me.previousId;
	if (fps) {
		hello.sig = await signHello(key.privateKey, {
			id: me.id,
			name: me.name,
			signerFp: fps.local,
			receiverFp: fps.remote,
			previousId: me.previousId
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
	/** The legacy UUID of a device that has switched to a key-derived ID (signed with the rest). */
	previousId?: string;
};

/** Introductions of other trusted devices, sent to a trusted device (see introductions.ts). */
type IntroMessage = { intros: Introduction[] };

/** Signed evictions, passed between trusted devices (see revocations.ts). */
type RevokeMessage = { records: RevocationRecord[] };

/**
 * Decides what a hello proves. Trusted means: the signature verifies for this connection *and*
 * the trusted record with that ID holds the same key. Repeating a trusted ID is not enough.
 */
export async function assessHello(
	data: HelloMessage,
	fps: ConnectionFingerprints | null,
	trustedPeers: TrustedPeer[],
	evicted?: ReadonlySet<string>
): Promise<
	Pick<
		ActivePeer,
		'isTrusted' | 'verified' | 'publicKey' | 'fingerprint' | 'trustIssue' | 'migration' | 'evicted'
	>
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
			receiverFp: fps.local,
			previousId: data.previousId
		}));
	const record = trustedPeers.find((p) => p.id === data.id);
	if (!verified) return { isTrusted: false, verified: false };

	const publicKey = data.publicKey;
	// A key-derived ID that is not the hash of the key it comes with is a lie, whoever signed it.
	if (isDerivedId(data.id) && (await deviceIdFromPublicKey(publicKey!)) !== data.id) {
		return { isTrusted: false, verified: false };
	}
	const fingerprint = await fingerprintOfKey(publicKey!);
	const shown = { verified, publicKey, fingerprint };
	// Evicted devices have no trusted record, but a hello must not read as a new device either.
	if (evicted?.has(data.id) || evicted?.has(await deviceIdFromPublicKey(publicKey!))) {
		return { isTrusted: false, ...shown, evicted: true };
	}
	if (!record) {
		const match = matchLegacy(
			{ id: data.id, publicKey: publicKey!, previousId: data.previousId },
			trustedPeers
		);
		return {
			isTrusted: false,
			...shown,
			migration: match ? { kind: match.kind, from: match.record.id } : undefined
		};
	}
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
	/** Devices a trusted device vouched for, in every status. */
	introductions = $state<PendingIntroduction[]>([]);
	/** The ones waiting for this device's person to approve or dismiss. */
	pendingIntroductions = $derived(this.introductions.filter((i) => i.status === 'pending'));
	/** Tombstones of evicted devices, in every status (see revocations.ts). */
	revocations = $state<Revocation[]>([]);
	/** The IDs that are evicted now. */
	evicted = $derived(evictedIds(this.revocations));
	/** Evictions nobody has read the notice of yet. */
	unseenEvictions = $derived(
		this.revocations.filter((r) => r.status === 'evicted' && !r.seen && r.id === r.record.revoked)
	);

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
		this.myId = await getDeviceId();

		const savedName = await deviceSettings.get<string>(DeviceSettingKeys.peerName);
		this.myName = savedName ?? 'My Device';

		this.hasGroup = !!(await getGroupSecret());

		const savedStrategy = await settings.get<RelayStrategy>(SettingKeys.peerRelayStrategy);
		if (savedStrategy) this.strategy = savedStrategy;

		this.iceServers =
			(await deviceSettings.get<RTCIceServer[]>(DeviceSettingKeys.peerIceServers)) ?? [];

		await this.reloadTrustedPeers();
		await this.reloadIntroductions();
		await this.reloadRevocations();
		// Evictions read from a bucket or folder change the trusted list behind this class's back.
		this.unsubscribeBucketEvictions ??= onRevocationsApplied(() => void this.refreshEvictions());
	}

	async reloadRevocations(): Promise<void> {
		this.revocations = await db.revocations.toArray();
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

		this.introAction = room.makeAction('intro') as unknown as MessageAction<IntroMessage>;
		this.introAction.onMessage = (data, { peerId }) => this.onIntroductions(data, peerId);

		this.revokeAction = room.makeAction('revoke') as unknown as MessageAction<RevokeMessage>;
		this.revokeAction.onMessage = (data, { peerId }) => this.onRevocations(data, peerId);

		this.helloAction.onMessage = (data, { peerId: trysteroId }) => {
			// Introductions can arrive right behind the hello: they wait for this to finish.
			const done = this.handleHello(data, trysteroId);
			this.helloDone.set(trysteroId, done);
			return done;
		};

		room.onPeerLeave = (trysteroId) => {
			const { [trysteroId]: _removed, ...rest } = this.peersMap;
			this.peersMap = rest;
			this.helloDone.delete(trysteroId);
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

	/** Per peer: the hello being checked, which introductions from that peer wait for. */
	private helloDone = new Map<string, Promise<void>>();

	private async handleHello(data: HelloMessage, trysteroId: string): Promise<void> {
		const fps = connectionFingerprints(this.room?.getPeers()[trysteroId]);
		let assessed = await assessHello(data, fps, this.trustedPeers, this.evicted);
		if (assessed.migration?.kind === 'rekey') {
			// The same key that was paired under the old ID signed this hello: the same device.
			await this.trustVerified({
				id: data.id,
				name: data.name,
				publicKey: assessed.publicKey!,
				previousId: data.previousId
			});
			assessed = await assessHello(data, fps, this.trustedPeers, this.evicted);
		}
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
			void this.shareIntroductions(trysteroId, data.id);
			void this.shareRevocations(trysteroId);
		}
	}

	// --- eviction (see revocations.ts) ---

	private revokeAction: MessageAction<RevokeMessage> | null = null;

	/** Tells a trusted device that connected about the evictions this device knows. */
	private async shareRevocations(trysteroId: string): Promise<void> {
		try {
			const records = recordsToShare(this.revocations);
			if (records.length) await this.revokeAction?.send({ records }, { target: trysteroId });
		} catch (e) {
			console.error('Could not share evictions', e);
		}
	}

	/** A trusted device sent evictions: apply the ones that hold, and pass them on. */
	private async onRevocations(data: RevokeMessage, trysteroId: string): Promise<void> {
		await this.helloDone.get(trysteroId);
		if (!this.peersMap[trysteroId]?.isTrusted) return;
		try {
			const accepted = await acceptRevocations(data?.records, {
				myId: this.myId,
				trusted: this.trustedPeers,
				tombstones: this.revocations
			});
			if (!accepted.length) return;
			await this.applyAccepted(accepted);
			await this.broadcastRevocations(
				accepted.map((a) => a.record),
				trysteroId
			);
		} catch (e) {
			console.error('Could not apply evictions', e);
		}
	}

	private async applyAccepted(accepted: AcceptedRevocation[]): Promise<void> {
		const ids = new Set<string>();
		for (const a of accepted) {
			for (const row of await applyRevocation(a)) ids.add(row.id);
		}
		await this.refreshEvictions(ids);
	}

	private unsubscribeBucketEvictions: (() => void) | null = null;

	/** Re-reads trust and tombstones, and marks the connected peers that are evicted (all of them when `ids` is omitted). */
	private async refreshEvictions(ids?: Set<string>): Promise<void> {
		await this.reloadTrustedPeers();
		await this.reloadRevocations();
		// Evicted devices stay in the room, but nothing is served to them or merged from them.
		const updated = { ...this.peersMap };
		for (const [tid, p] of Object.entries(updated)) {
			if (ids ? ids.has(p.persistentId) : this.evicted.has(p.persistentId)) {
				updated[tid] = { ...p, isTrusted: false, evicted: true, trustIssue: undefined };
			}
		}
		this.peersMap = updated;
	}

	/** Sends records to every connected trusted device except `exceptTrysteroId`. */
	private async broadcastRevocations(
		records: RevocationRecord[],
		exceptTrysteroId?: string
	): Promise<void> {
		for (const peer of Object.values(this.peersMap)) {
			if (!peer.isTrusted || peer.trysteroId === exceptTrysteroId) continue;
			try {
				await this.revokeAction?.send({ records }, { target: peer.trysteroId });
			} catch (e) {
				console.error('Could not pass on an eviction', e);
			}
		}
	}

	/**
	 * Evicts a trusted device from the group: signs the record, drops its trust here and tells the
	 * connected devices, which pass it on. Returns the record (to publish to the bucket).
	 */
	async evictPeer(persistentId: string): Promise<RevocationRecord> {
		const target = this.trustedPeers.find((p) => p.id === persistentId);
		if (!target) throw new Error('This device is not trusted here.');
		if (persistentId === this.myId) throw new Error('A device cannot evict itself.');
		const record = await signRevocation(await getDeviceKey(), this.myId, target.id);
		await this.applyAccepted([
			{ record, evictor: { name: this.myName } as TrustedPeer, subject: target, self: false }
		]);
		await this.broadcastRevocations([record]);
		return record;
	}

	/** A person has read the eviction notices. */
	async markEvictionsSeen(): Promise<void> {
		const rows = this.revocations.filter((r) => r.status === 'evicted' && !r.seen);
		if (!rows.length) return;
		await db.revocations.bulkPut(rows.map((r) => ({ ...$state.snapshot(r), seen: true })));
		await this.reloadRevocations();
	}

	// --- introductions (see introductions.ts) ---

	private introAction: MessageAction<IntroMessage> | null = null;

	/**
	 * A trusted device just connected: offer it the other trusted devices, and tell the other
	 * connected trusted devices about it. They are proposals, so the receivers ask their people.
	 * Read-only peers get none: they are not a party to the group's membership.
	 */
	private async shareIntroductions(trysteroId: string, persistentId: string): Promise<void> {
		try {
			const action = this.introAction;
			const key = await getDeviceKey();
			const me = { id: this.myId, key };
			const canTell = (id: string) =>
				this.trustedPeers.some((p) => p.id === id && p.publicKey && !p.readOnly);
			if (!action || !canTell(persistentId)) return;

			const toNew = await introductionsFor(persistentId, me, this.trustedPeers);
			if (toNew.length) await action.send({ intros: toNew }, { target: trysteroId });

			const arrived = this.trustedPeers.filter((p) => p.id === persistentId);
			for (const other of Object.values(this.peersMap)) {
				if (!other.isTrusted || other.trysteroId === trysteroId || !canTell(other.persistentId)) {
					continue;
				}
				const intros = await introductionsFor(
					other.persistentId,
					me,
					arrived // only the device that just arrived
				);
				if (intros.length) await action.send({ intros }, { target: other.trysteroId });
			}
		} catch (e) {
			console.error('Could not share introductions', e);
		}
	}

	private async onIntroductions(data: IntroMessage, trysteroId: string): Promise<void> {
		await this.helloDone.get(trysteroId);
		const sender = this.peersMap[trysteroId];
		if (!sender?.isTrusted) return;
		const introducer = this.trustedPeers.find((p) => p.id === sender.persistentId);
		if (!introducer) return;
		try {
			const key = await getDeviceKey();
			const fresh = await receiveIntroductions(data?.intros, {
				me: { id: this.myId, publicKey: key.publicKey },
				introducer,
				trusted: this.trustedPeers,
				pending: this.introductions,
				evicted: this.evicted
			});
			if (fresh.length) {
				await db.introductions.bulkPut(fresh);
				await this.reloadIntroductions();
			}
		} catch (e) {
			console.error('Could not store introductions', e);
		}
	}

	async reloadIntroductions(): Promise<void> {
		this.introductions = await db.introductions.toArray();
	}

	/** Trusts the introduced device, as this device's own decision. */
	async approveIntroduction(id: string): Promise<void> {
		const intro: PendingIntroduction | undefined = await db.introductions.get(id);
		if (!intro || intro.status !== 'pending') return;
		if (this.evicted.has(intro.id) || this.evicted.has(intro.subjectId)) {
			await db.introductions.delete(id);
			await this.reloadIntroductions();
			throw new Error('That device was evicted from the group.');
		}
		// Trust the first introducer still trusted: it is whom this approval rests on.
		// The introducer may have switched to a key-derived ID since it vouched: find it by either.
		const introducer = intro.introducedBy
			.map((b) => peerOf(this.trustedPeers, b.id))
			.find((p) => p !== undefined);
		if (!introducer) {
			await db.introductions.delete(id);
			await this.reloadIntroductions();
			throw new Error('The device that introduced it is no longer trusted here.');
		}
		await this.trustVerified({
			id: intro.subjectId,
			name: intro.name,
			publicKey: intro.publicKey,
			addedBy: introducer.id
		});
	}

	/** Declines an introduction. It is kept as dismissed so the same one is not asked again. */
	async dismissIntroduction(id: string): Promise<void> {
		const intro: PendingIntroduction | undefined = await db.introductions.get(id);
		if (!intro) return;
		intro.status = 'dismissed';
		await db.introductions.put(intro);
		await this.reloadIntroductions();
	}

	/** Sends this device's hello, signed for the connection to `trysteroId` (unsigned if its fingerprints can't be read). */
	private async sendHello(trysteroId: string): Promise<void> {
		try {
			const fps = connectionFingerprints(this.room?.getPeers()[trysteroId]);
			const previousId = await deviceSettings.get<string>(DeviceSettingKeys.previousDeviceId);
			const hello = await buildHello(
				{ id: this.myId, name: this.myName, previousId: previousId || undefined },
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
			this.introAction = null;
			this.revokeAction = null;
		}
		this.helloDone.clear();
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
	async trustVerified(peer: {
		id: string;
		name: string;
		publicKey: string;
		/** The trusted device whose introduction this approval rests on. */
		addedBy?: string;
		/** The legacy ID the device names, which a key-less record of it is found by. */
		previousId?: string;
		/** A person is pairing with this device on purpose: an eviction of it stops counting. */
		readmit?: boolean;
	}): Promise<TrustedPeer> {
		const keyId = await deviceIdFromPublicKey(peer.publicKey);
		const tombstoned = [peer.id, keyId].filter((id) => this.evicted.has(id));
		if (tombstoned.length) {
			if (!peer.readmit) throw new Error('This device was evicted from the group.');
			await clearTombstones(tombstoned);
			await this.reloadRevocations();
		}
		// A device that switched to a key-derived ID replaces its old record instead of being added next to it.
		const legacy = matchLegacy(
			{ id: peer.id, publicKey: peer.publicKey, previousId: peer.previousId },
			await db.peers.toArray()
		);
		if (legacy) await replaceTrustedRecord(legacy.record.id, peer);
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
		tp.legacyIds = existing?.legacyIds;
		// Pairing directly is a stronger basis than an introduction, so it clears `addedBy`.
		tp.addedBy = peer.addedBy ?? (sameKey ? existing.addedBy : undefined);
		await db.peers.put(tp);
		this.trustedPeers = await db.peers.toArray();
		// Whatever way it got here, the device no longer waits for approval.
		await db.introductions.delete(keyId);
		await this.reloadIntroductions();

		const updated = { ...this.peersMap };
		for (const [tid, p] of Object.entries(updated)) {
			if (p.persistentId === peer.id && p.publicKey === peer.publicKey) {
				updated[tid] = {
					...p,
					isTrusted: true,
					evicted: undefined,
					trustIssue: undefined,
					migration: undefined,
					name: tp.name
				};
			}
		}
		this.peersMap = updated;
		return tp;
	}

	/**
	 * A person confirms that the device in the room (which names a legacy ID of a key-less trusted
	 * record) is that device: its record is replaced by the one under the key-derived ID.
	 */
	async approveMigration(trysteroId: string): Promise<void> {
		const peer = this.peersMap[trysteroId];
		if (peer?.migration?.kind !== 'approve' || !peer.publicKey) {
			throw new Error('This device is not waiting to replace a trusted one.');
		}
		await this.trustVerified({
			id: peer.persistentId,
			name: peer.name,
			publicKey: peer.publicKey,
			previousId: peer.migration.from
		});
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
