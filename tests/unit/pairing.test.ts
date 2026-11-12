/*
    Pairing by invite link: the inviter/joiner protocol over an in-memory stand-in for trystero.
*/
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '@trystero-p2p/core';
import { TrustedPeer } from '#lib/data/model';
import {
	deviceIdFromPublicKey,
	formatFingerprint,
	generateDeviceKey,
	type DeviceKey
} from '#lib/sync/deviceKey';
import { parseInvite } from '#lib/sync/invite';
import { InviteSession, JoinSession, type PairingHost } from '#lib/sync/pairing.svelte';
import { buildHello, type HelloMessage, type RelayStrategy } from '#lib/sync/peerPresence.svelte';
import { generateGroupSecret } from '#lib/sync/syncGroup';

// ─── an in-memory network ────────────────────────────────────────────────────────────────────

type Handler = ((data: any, ctx: { peerId: string }) => void | Promise<void>) | null;

/** A room that connects every pair of rooms with the same name and password, like the relay would. */
class FakeNet {
	private rooms: FakeRoom[] = [];
	private count = 0;

	join(roomId: string, password: string): FakeRoom {
		const room = new FakeRoom(
			this,
			`peer${++this.count}`,
			roomId,
			password,
			`0${this.count}:AA:BB`
		);
		for (const other of this.rooms) {
			if (other.roomId === roomId && other.password === password && !other.left) {
				setTimeout(() => {
					if (room.left || other.left) return;
					room.connect(other);
					other.connect(room);
				}, 0);
			}
		}
		this.rooms.push(room);
		return room;
	}

	deliver(from: FakeRoom, to: string, name: string, data: unknown) {
		const target = this.rooms.find((r) => r.selfId === to && !r.left);
		setTimeout(
			() =>
				void target?.actions.get(name)?.onMessage?.(structuredClone(data), { peerId: from.selfId }),
			0
		);
	}
}

class FakeRoom {
	actions = new Map<
		string,
		{ onMessage: Handler; send: (d: unknown, o?: { target?: string }) => Promise<void> }
	>();
	peers: Record<string, FakeRoom> = {};
	onPeerJoin: ((id: string) => void) | null = null;
	onPeerLeave: ((id: string) => void) | null = null;
	left = false;

	constructor(
		private net: FakeNet,
		readonly selfId: string,
		readonly roomId: string,
		readonly password: string,
		readonly fingerprint: string
	) {}

	connect(other: FakeRoom) {
		this.peers[other.selfId] = other;
		this.onPeerJoin?.(other.selfId);
	}

	makeAction(name: string) {
		const action = {
			onMessage: null as Handler,
			send: async (data: unknown, opts?: { target?: string }) => {
				if (this.left) throw new Error('left the room');
				for (const id of opts?.target ? [opts.target] : Object.keys(this.peers)) {
					this.net.deliver(this, id, name, data);
				}
			}
		};
		this.actions.set(name, action);
		return action;
	}

	/** Enough of an RTCPeerConnection for `connectionFingerprints`. */
	getPeers() {
		return Object.fromEntries(
			Object.entries(this.peers).map(([id, other]) => [
				id,
				{
					localDescription: { sdp: `a=fingerprint:sha-256 ${this.fingerprint}` },
					remoteDescription: { sdp: `a=fingerprint:sha-256 ${other.fingerprint}` }
				}
			])
		);
	}

	async leave() {
		this.left = true;
		for (const other of Object.values(this.peers)) other.onPeerLeave?.(this.selfId);
	}
}

// ─── a device ────────────────────────────────────────────────────────────────────────────────

interface TestHost extends PairingHost {
	trustedPeers: TrustedPeer[];
	secret: string | null;
	key: DeviceKey;
}

async function device(net: FakeNet, name: string, id = `${name}-uuid`): Promise<TestHost> {
	const key = await generateDeviceKey();
	const host: TestHost = {
		myId: id,
		myName: name,
		strategy: 'nostr' as RelayStrategy,
		trustedPeers: [],
		secret: null,
		key,
		getKey: async () => key,
		ensureGroupSecret: async () => (host.secret ??= generateGroupSecret()),
		adoptGroupSecret: async (secret) => {
			host.secret = secret;
		},
		joinPairingRoom: async ({ roomId, password }) => net.join(roomId, password) as unknown as Room,
		trustVerified: async (peer) => {
			const existing = host.trustedPeers.find((p) => p.id === peer.id);
			if (existing?.publicKey && existing.publicKey !== peer.publicKey) {
				throw new Error('different key');
			}
			host.trustedPeers = host.trustedPeers.filter((p) => p.id !== peer.id);
			const tp = new TrustedPeer();
			Object.assign(tp, { id: peer.id, name: peer.name, publicKey: peer.publicKey });
			host.trustedPeers.push(tp);
			return tp;
		}
	};
	return host;
}

async function until(check: () => boolean, what: string) {
	for (let i = 0; i < 400; i++) {
		if (check()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error('Timed out waiting for ' + what);
}

/** Inviter A has opened an invite; joiner B has opened its link and is in the room. */
async function setup(opts: { alter?: (link: string) => string } = {}) {
	const net = new FakeNet();
	const a = await device(net, 'Laptop');
	const b = await device(net, 'Anna phone');
	const invite = new InviteSession(a, { ackTimeoutMs: 100 });
	await invite.start('https://cashier.test');
	const parsed = parseInvite(opts.alter ? opts.alter(invite.link) : invite.link);
	if (!parsed.ok) throw new Error('bad link');
	const join = new JoinSession(b, parsed.payload);
	await join.start();
	return { net, a, b, invite, join };
}

afterEach(() => {
	vi.useRealTimers();
});

describe('pairing by invite', () => {
	it('pairs two devices: approval trusts both ways and hands over the group secret', async () => {
		const { a, b, invite, join } = await setup();

		await until(() => invite.candidates.length === 1, 'the joiner to show up');
		const [candidate] = invite.candidates;
		expect(candidate.name).toBe('Anna phone');
		expect(candidate.fingerprint).toBe(
			formatFingerprint(await deviceIdFromPublicKey(b.key.publicKey))
		);
		expect(join.status).not.toBe('approved');
		expect(b.trustedPeers).toHaveLength(0);

		await invite.approve(candidate.trysteroId);
		await until(() => join.status === 'approved', 'the joiner to be approved');

		expect(invite.status).toBe('approved');
		expect(a.trustedPeers.map((p) => [p.id, p.publicKey])).toEqual([
			['Anna phone-uuid', b.key.publicKey]
		]);
		expect(b.trustedPeers.map((p) => [p.id, p.publicKey])).toEqual([
			['Laptop-uuid', a.key.publicKey]
		]);
		expect(a.secret).toBeTruthy();
		expect(b.secret).toBe(a.secret);
	});

	it('does not trust the joiner before the inviter approves', async () => {
		const { a, b, invite, join } = await setup();

		await until(() => invite.candidates.length === 1, 'the joiner to show up');
		await until(() => join.status === 'waiting', 'the joiner to see the inviter');

		expect(a.trustedPeers).toHaveLength(0);
		expect(b.trustedPeers).toHaveLength(0);
		expect(b.secret).toBeNull();
	});

	it('lets the inviter turn a device away, and the invite stays open', async () => {
		const { a, b, invite, join } = await setup();
		await until(() => invite.candidates.length === 1, 'the joiner to show up');

		await invite.reject(invite.candidates[0].trysteroId);
		await until(() => join.status === 'rejected', 'the joiner to be rejected');

		expect(invite.status).toBe('waiting');
		expect(invite.candidates).toHaveLength(0);
		expect(a.trustedPeers).toHaveLength(0);
		expect(b.trustedPeers).toHaveLength(0);
		expect(b.secret).toBeNull();
	});

	it('works once: a second device cannot be approved after the first', async () => {
		const { net, invite } = await setup();
		const c = await device(net, 'Intruder');
		const link = parseInvite(invite.link);
		if (!link.ok) throw new Error('bad link');
		const second = new JoinSession(c, link.payload);
		await second.start();
		await until(() => invite.candidates.length === 2, 'both joiners to show up');

		const [first, other] = invite.candidates;
		await invite.approve(first.trysteroId);

		await expect(invite.approve(other.trysteroId)).rejects.toThrow('no longer open');
		expect(c.trustedPeers).toHaveLength(0);
		expect(c.secret).toBeNull();
	});

	it('does not list a device that sends no proof of its key (an older version)', async () => {
		const net = new FakeNet();
		const a = await device(net, 'Laptop');
		const invite = new InviteSession(a);
		await invite.start('https://cashier.test');
		const parsed = parseInvite(invite.link);
		if (!parsed.ok) throw new Error('bad link');

		// A raw peer in the invite room that sends the old, unsigned hello.
		const { deriveInviteRoom, deriveInvitePassword } = await import('#lib/sync/invite');
		const room = net.join(
			await deriveInviteRoom(parsed.payload.seed),
			await deriveInvitePassword(parsed.payload.seed)
		);
		const hello = room.makeAction('hello');
		room.onPeerJoin = (id) =>
			void hello.send({ id: 'old-uuid', name: 'Old phone' } satisfies HelloMessage, { target: id });
		await new Promise((r) => setTimeout(r, 50));

		expect(invite.candidates).toHaveLength(0);
		await invite.close();
	});

	it('does not list a hello replayed from another connection', async () => {
		const net = new FakeNet();
		const a = await device(net, 'Laptop');
		const b = await device(net, 'Anna phone');
		const invite = new InviteSession(a);
		await invite.start('https://cashier.test');
		const parsed = parseInvite(invite.link);
		if (!parsed.ok) throw new Error('bad link');

		const { deriveInviteRoom, deriveInvitePassword } = await import('#lib/sync/invite');
		const room = net.join(
			await deriveInviteRoom(parsed.payload.seed),
			await deriveInvitePassword(parsed.payload.seed)
		);
		const hello = room.makeAction('hello');
		// B's hello, signed for some other connection.
		const stale = await buildHello({ id: b.myId, name: b.myName }, b.key, {
			local: 'EE:EE:EE',
			remote: 'FF:FF:FF'
		});
		room.onPeerJoin = (id) => void hello.send(stale, { target: id });
		await new Promise((r) => setTimeout(r, 50));

		expect(invite.candidates).toHaveLength(0);
		await invite.close();
	});

	it('is ignored by a joiner whose link names another device', async () => {
		const { a, b, invite, join } = await setup({
			alter: (link) => {
				// Swap the fingerprint for a different device's.
				const token = link.slice(link.indexOf('#') + 1);
				const json = JSON.parse(atob(token.replace(/-/g, '+').replace(/_/g, '/')));
				json.fingerprint = 'abcdefghjkmnpqrstvwxyz0123'.slice(0, 26);
				return (
					'#' +
					btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
				);
			}
		});

		await until(() => invite.candidates.length === 1, 'the joiner to show up');
		await invite.approve(invite.candidates[0].trysteroId);
		await new Promise((r) => setTimeout(r, 50));

		// The inviter is not the device the link names: the joiner trusts nothing and takes no secret.
		expect(join.status).toBe('connecting');
		expect(b.trustedPeers).toHaveLength(0);
		expect(b.secret).toBeNull();
		expect(a.trustedPeers).toHaveLength(1);
		await join.close();
	});

	it('cannot approve a device whose key differs from the trusted one with that ID', async () => {
		const net = new FakeNet();
		const a = await device(net, 'Laptop');
		const real = await generateDeviceKey();
		const known = new TrustedPeer();
		Object.assign(known, { id: 'Anna phone-uuid', name: 'Anna phone', publicKey: real.publicKey });
		a.trustedPeers = [known];
		const b = await device(net, 'Anna phone');
		const invite = new InviteSession(a);
		await invite.start('https://cashier.test');
		const parsed = parseInvite(invite.link);
		if (!parsed.ok) throw new Error('bad link');
		await new JoinSession(b, parsed.payload).start();

		await until(() => invite.candidates.length === 1, 'the joiner to show up');

		expect(invite.candidates[0].issue).toBe('key-mismatch');
		await expect(invite.approve(invite.candidates[0].trysteroId)).rejects.toThrow('different key');
		expect(a.trustedPeers).toEqual([known]);
		await invite.close();
	});

	it('trusts nothing and takes no secret when the inviter sends an invalid one', async () => {
		const { a, b, invite, join } = await setup();
		a.ensureGroupSecret = async () => 'not a secret';
		await until(() => invite.candidates.length === 1, 'the joiner to show up');

		await invite.approve(invite.candidates[0].trysteroId);
		await until(() => join.status === 'error', 'the joiner to refuse');

		expect(b.trustedPeers).toHaveLength(0);
		expect(b.secret).toBeNull();
	});

	it('refuses to adopt anything when the inviter key conflicts with a trusted record', async () => {
		const net = new FakeNet();
		const a = await device(net, 'Laptop');
		const b = await device(net, 'Anna phone');
		const known = new TrustedPeer();
		Object.assign(known, {
			id: 'Laptop-uuid',
			name: 'Laptop',
			publicKey: (await generateDeviceKey()).publicKey
		});
		b.trustedPeers = [known];
		const invite = new InviteSession(a);
		await invite.start('https://cashier.test');
		const parsed = parseInvite(invite.link);
		if (!parsed.ok) throw new Error('bad link');
		const join = new JoinSession(b, parsed.payload);
		await join.start();
		await until(() => invite.candidates.length === 1, 'the joiner to show up');

		await invite.approve(invite.candidates[0].trysteroId);
		await until(() => join.status === 'error', 'the joiner to refuse');

		expect(b.secret).toBeNull();
		expect(b.trustedPeers).toEqual([known]);
	});
});

describe('invite lifetime', () => {
	it('is refused by a joiner once expired, without joining the room', async () => {
		const net = new FakeNet();
		const a = await device(net, 'Laptop');
		const b = await device(net, 'Anna phone');
		const invite = new InviteSession(a);
		await invite.start('https://cashier.test');
		const parsed = parseInvite(invite.link);
		if (!parsed.ok) throw new Error('bad link');

		const join = new JoinSession(b, parsed.payload, { now: () => parsed.payload.exp + 1 });
		await join.start();

		expect(join.status).toBe('expired');
		await new Promise((r) => setTimeout(r, 30));
		expect(invite.candidates).toHaveLength(0);
		await invite.close();
	});

	it('expires on the inviter side and leaves the room', async () => {
		vi.useFakeTimers();
		const net = new FakeNet();
		const a = await device(net, 'Laptop');
		const invite = new InviteSession(a);
		await invite.start('https://cashier.test');
		expect(invite.status).toBe('waiting');

		await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);

		expect(invite.status).toBe('expired');
	});

	it('creates the group secret on the first invite', async () => {
		const net = new FakeNet();
		const a = await device(net, 'Laptop');
		expect(a.secret).toBeNull();

		await new InviteSession(a).start('https://cashier.test');

		expect(a.secret).toBeTruthy();
	});
});
