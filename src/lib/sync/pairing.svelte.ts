/**
 * Pairing two devices by invite link (doc/projects/2026-11-11_device-identity.md, step 3).
 *
 * Both sides meet in a one-use room derived from the invite (see invite.ts) and exchange the same
 * signed hello as Peer Sync does (see `buildHello` / `assessHello`):
 *
 * - The **joiner** accepts only the hello whose key hashes to the `fingerprint` in the link. Opening
 *   the link is its consent, so it trusts that device once it approves.
 * - The **inviter** lists every verified device that arrives ("Anna's phone · 7KQ2-M9XA wants to
 *   join"). Tapping Approve is what authenticates the joiner, who is otherwise unknown to it. Then
 *   it trusts the joiner, sends the sync group secret and leaves the room, so a link works once.
 *
 * Nobody is trusted without a verified signature, and a leaked link only lets a stranger ask.
 */
import type { MessageAction, Room } from '@trystero-p2p/core';
import type { TrustedPeer } from '#lib/data/model';
import { deviceIdFromPublicKey, type DeviceKey } from '#lib/sync/deviceKey';
import {
	deriveInvitePassword,
	deriveInviteRoom,
	createInvitePayload,
	inviteLink,
	type InvitePayload
} from '#lib/sync/invite';
import {
	assessHello,
	buildHello,
	connectionFingerprints,
	type HelloMessage,
	type RelayStrategy
} from '#lib/sync/peerPresence.svelte';
import { isValidGroupSecret } from '#lib/sync/syncGroup';

/** How long the inviter waits for the joiner to confirm it has the secret before it leaves. */
const ACK_TIMEOUT_MS = 8000;

/** What a pairing session needs from this device. `PeerPresence` implements it; tests supply their own. */
export interface PairingHost {
	readonly myId: string;
	readonly myName: string;
	readonly strategy: RelayStrategy;
	readonly trustedPeers: TrustedPeer[];
	getKey(): Promise<DeviceKey>;
	ensureGroupSecret(): Promise<string>;
	adoptGroupSecret(secret: string): Promise<void>;
	joinPairingRoom(opts: {
		strategy: RelayStrategy;
		roomId: string;
		password: string;
	}): Promise<Room>;
	/** IDs of evicted devices; pairing with one on purpose clears its eviction (`readmit`). */
	readonly evicted?: ReadonlySet<string>;
	trustVerified(peer: {
		id: string;
		name: string;
		publicKey: string;
		readmit?: boolean;
	}): Promise<TrustedPeer>;
}

type ApproveMsg = { secret: string };
type NoticeMsg = { v: 1 };

/** The room's actions, with this device's signed hello sent to every peer that joins. */
async function openPairingRoom(host: PairingHost, payload: InvitePayload) {
	const room = await host.joinPairingRoom({
		strategy: payload.strategy,
		roomId: await deriveInviteRoom(payload.seed),
		password: await deriveInvitePassword(payload.seed)
	});
	// Action names are limited to 12 bytes.
	const hello = room.makeAction('hello') as unknown as MessageAction<HelloMessage>;
	const approve = room.makeAction('pair-approve') as unknown as MessageAction<ApproveMsg>;
	const reject = room.makeAction('pair-reject') as unknown as MessageAction<NoticeMsg>;
	const ack = room.makeAction('pair-ack') as unknown as MessageAction<NoticeMsg>;

	room.onPeerJoin(({ peerId }) => {
		void (async () => {
			try {
				const msg = await buildHello(
					{ id: host.myId, name: host.myName },
					await host.getKey(),
					connectionFingerprints(room.getPeers()[peerId])
				);
				await hello.send(msg, { target: peerId });
			} catch (e) {
				console.error('Could not send hello', e);
			}
		})();
	});
	return { room, hello, approve, reject, ack };
}

/** A verified device waiting in the invite room for the inviter's decision. */
export interface Candidate {
	trysteroId: string;
	/** Its device ID as it announces it. */
	id: string;
	/** The name it announces; anyone can announce any name. */
	name: string;
	/** Short fingerprint of its key (`7KQ2-M9XA`). */
	fingerprint: string;
	publicKey: string;
	/** This device is already trusted with this key (it is joining again, e.g. after clearing the sync group). */
	alreadyTrusted: boolean;
	/** The key differs from the one trusted under the same ID: it cannot be approved. */
	issue?: 'key-mismatch';
	/** This device was evicted from the group. Approving it pairs with it again, which clears that here. */
	evicted: boolean;
}

export type InviteStatus =
	| 'idle'
	| 'starting'
	| 'waiting'
	| 'approved'
	| 'expired'
	| 'closed'
	| 'error';

export class InviteSession {
	status = $state<InviteStatus>('idle');
	link = $state('');
	/** Expiry of the link, ms since the epoch. */
	expiresAt = $state(0);
	candidates = $state<Candidate[]>([]);
	error = $state('');
	/** Name of the device that was approved. */
	approvedName = $state('');

	private room: Room | null = null;
	private actions: Awaited<ReturnType<typeof openPairingRoom>> | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private ackWaiter: { peerId: string; resolve: () => void } | null = null;

	private now: () => number;
	private ackTimeoutMs: number;

	constructor(
		private host: PairingHost,
		options: { now?: () => number; ackTimeoutMs?: number } = {}
	) {
		this.now = options.now ?? Date.now;
		this.ackTimeoutMs = options.ackTimeoutMs ?? ACK_TIMEOUT_MS;
	}

	/** Creates the invite and waits in its room. `origin` is the app's own origin for the link. */
	async start(origin: string): Promise<void> {
		if (this.status !== 'idle') return;
		this.status = 'starting';
		try {
			// The group exists from the first invite on, so there is a secret to hand over.
			await this.host.ensureGroupSecret();
			const key = await this.host.getKey();
			const payload = createInvitePayload(
				{
					name: this.host.myName,
					fingerprint: await deviceIdFromPublicKey(key.publicKey),
					strategy: this.host.strategy
				},
				this.now()
			);
			this.link = inviteLink(origin, payload);
			this.expiresAt = payload.exp;

			const actions = await openPairingRoom(this.host, payload);
			this.actions = actions;
			this.room = actions.room;
			actions.hello.onMessage((data, { peerId }) => this.onHello(data, peerId));
			actions.ack.onMessage((_data, { peerId }) => {
				if (this.ackWaiter?.peerId === peerId) this.ackWaiter.resolve();
			});
			actions.room.onPeerLeave(({ peerId }) => {
				this.candidates = this.candidates.filter((c) => c.trysteroId !== peerId);
			});

			this.timer = setTimeout(() => void this.expire(), Math.max(0, payload.exp - this.now()));
			this.status = 'waiting';
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			this.status = 'error';
			await this.leaveRoom();
		}
	}

	private async onHello(data: HelloMessage, peerId: string): Promise<void> {
		if (this.status !== 'waiting') return;
		const assessed = await assessHello(
			data,
			connectionFingerprints(this.room?.getPeers()[peerId]),
			this.host.trustedPeers,
			this.host.evicted
		);
		// A device that can't prove a key (older version, forged hello) can't be paired at all.
		if (!assessed.verified || !assessed.publicKey) return;
		const candidate: Candidate = {
			trysteroId: peerId,
			id: data.id,
			name: data.name,
			fingerprint: assessed.fingerprint ?? '',
			publicKey: assessed.publicKey,
			alreadyTrusted: assessed.isTrusted,
			issue: assessed.trustIssue === 'key-mismatch' ? 'key-mismatch' : undefined,
			evicted: !!assessed.evicted
		};
		this.candidates = [...this.candidates.filter((c) => c.trysteroId !== peerId), candidate];
	}

	/** Trusts the device, hands it the group secret and closes the invite. */
	async approve(trysteroId: string): Promise<void> {
		const candidate = this.candidates.find((c) => c.trysteroId === trysteroId);
		if (this.status !== 'waiting' || !candidate || !this.actions) {
			throw new Error('This invite is no longer open');
		}
		if (candidate.issue) {
			throw new Error(
				'This device presents a different key than the trusted device with the same ID.'
			);
		}
		// One approval per link: from here on nobody else can be approved.
		this.status = 'approved';
		this.approvedName = candidate.name;
		this.candidates = [];
		try {
			await this.host.trustVerified({
				id: candidate.id,
				name: candidate.name,
				publicKey: candidate.publicKey,
				readmit: true
			});
			const secret = await this.host.ensureGroupSecret();
			const acked = new Promise<void>((resolve) => {
				this.ackWaiter = { peerId: trysteroId, resolve };
			});
			await this.actions.approve.send({ secret }, { target: trysteroId });
			let giveUp: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([acked, new Promise((r) => (giveUp = setTimeout(r, this.ackTimeoutMs)))]);
			clearTimeout(giveUp);
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			this.status = 'error';
		} finally {
			await this.leaveRoom();
		}
	}

	/** Turns a device away. It is told, and the invite stays open for others. */
	async reject(trysteroId: string): Promise<void> {
		this.candidates = this.candidates.filter((c) => c.trysteroId !== trysteroId);
		try {
			await this.actions?.reject.send({ v: 1 }, { target: trysteroId });
		} catch {
			// The device may have left already.
		}
	}

	/** Cancels the invite. An approval that already happened stays. */
	async close(): Promise<void> {
		if (this.status === 'waiting' || this.status === 'starting' || this.status === 'idle') {
			this.status = 'closed';
		}
		await this.leaveRoom();
	}

	private async expire(): Promise<void> {
		if (this.status === 'waiting') this.status = 'expired';
		this.candidates = [];
		await this.leaveRoom();
	}

	private async leaveRoom(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.ackWaiter?.resolve();
		this.ackWaiter = null;
		const room = this.room;
		this.room = null;
		this.actions = null;
		await room?.leave();
	}
}

export type JoinStatus =
	| 'idle'
	| 'connecting'
	| 'waiting'
	| 'approved'
	| 'rejected'
	| 'expired'
	| 'error';

export class JoinSession {
	status = $state<JoinStatus>('idle');
	error = $state('');
	/** The inviter's name: as the link says until its hello is verified, then as it announces it. */
	inviterName = $state('');

	private room: Room | null = null;
	private actions: Awaited<ReturnType<typeof openPairingRoom>> | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private inviter: { trysteroId: string; id: string; name: string; publicKey: string } | null =
		null;
	/** An approval can arrive before the inviter's hello has been checked. */
	private earlyApproval: { peerId: string; secret: string } | null = null;
	private finishing = false;

	private now: () => number;

	constructor(
		private host: PairingHost,
		readonly invite: InvitePayload,
		options: { now?: () => number } = {}
	) {
		this.now = options.now ?? Date.now;
		this.inviterName = invite.name;
	}

	/** Joins the invite's room and waits for the inviter's decision. */
	async start(): Promise<void> {
		if (this.status !== 'idle') return;
		if (this.invite.exp <= this.now()) {
			this.status = 'expired';
			return;
		}
		this.status = 'connecting';
		try {
			const actions = await openPairingRoom(this.host, this.invite);
			this.actions = actions;
			this.room = actions.room;
			actions.hello.onMessage((data, { peerId }) => this.onHello(data, peerId));
			actions.approve.onMessage((data, { peerId }) => this.onApprove(data, peerId));
			actions.reject.onMessage((_data, { peerId }) => {
				if (this.inviter?.trysteroId === peerId && this.status === 'waiting') {
					this.status = 'rejected';
					void this.leaveRoom();
				}
			});
			this.timer = setTimeout(
				() => {
					if (this.status === 'connecting' || this.status === 'waiting') this.status = 'expired';
					void this.leaveRoom();
				},
				Math.max(0, this.invite.exp - this.now())
			);
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			this.status = 'error';
			await this.leaveRoom();
		}
	}

	private async onHello(data: HelloMessage, peerId: string): Promise<void> {
		if (this.inviter || (this.status !== 'connecting' && this.status !== 'waiting')) return;
		const assessed = await assessHello(
			data,
			connectionFingerprints(this.room?.getPeers()[peerId]),
			this.host.trustedPeers,
			this.host.evicted
		);
		if (!assessed.verified || !assessed.publicKey) return;
		// Other joiners share this room. Only the device the link names is the inviter.
		if ((await deviceIdFromPublicKey(assessed.publicKey)) !== this.invite.fingerprint) return;
		if (this.inviter) return;

		this.inviter = {
			trysteroId: peerId,
			id: data.id,
			name: data.name,
			publicKey: assessed.publicKey
		};
		this.inviterName = data.name;
		this.status = 'waiting';
		const early = this.earlyApproval;
		if (early && early.peerId === peerId) await this.finish(early.secret);
	}

	private async onApprove(data: ApproveMsg, peerId: string): Promise<void> {
		if (this.status !== 'connecting' && this.status !== 'waiting') return;
		if (!this.inviter) {
			this.earlyApproval = { peerId, secret: data?.secret };
			return;
		}
		if (peerId !== this.inviter.trysteroId) return;
		await this.finish(data?.secret);
	}

	/** The inviter approved: trust it, take over the group secret and confirm. */
	private async finish(secret: unknown): Promise<void> {
		const inviter = this.inviter;
		if (!inviter || this.finishing) return;
		this.finishing = true;
		try {
			if (!isValidGroupSecret(secret))
				throw new Error('The invite did not carry a valid sync group.');
			await this.host.trustVerified({
				id: inviter.id,
				name: inviter.name,
				publicKey: inviter.publicKey,
				readmit: true
			});
			await this.host.adoptGroupSecret(secret);
			this.status = 'approved';
			await this.actions?.ack.send({ v: 1 }, { target: inviter.trysteroId });
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			this.status = 'error';
		} finally {
			await this.leaveRoom();
		}
	}

	async close(): Promise<void> {
		if (this.status === 'connecting' || this.status === 'waiting' || this.status === 'idle') {
			this.status = 'idle';
		}
		await this.leaveRoom();
	}

	private async leaveRoom(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		const room = this.room;
		this.room = null;
		this.actions = null;
		await room?.leave();
	}
}
