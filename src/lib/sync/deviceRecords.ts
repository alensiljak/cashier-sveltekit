/**
 * What a device publishes about itself in an S3 bucket or WebDAV folder, `devices/<id>.json`, so
 * that the others can check the signatures on its objects and show who it is (name and
 * fingerprint) before trusting it. See doc/projects/2026-11-11_device-identity.md, step 5.
 *
 * The record certifies itself: the ID is the hash of the key in it, and the key signed the rest.
 * Anyone with the passphrase can publish a record, but only for a key they hold, so nobody can
 * publish one under another device's ID.
 */
import db from '#lib/data/db';
import type { TrustedPeer } from '#lib/data/model';
import { matchLegacy, replaceTrustedRecord } from '#lib/sync/identityMigration';
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import {
	deviceIdFromPublicKey,
	fingerprintOfKey,
	getDeviceKey,
	signMessage,
	verifyMessage
} from '#lib/sync/deviceKey';
import type { RemoteStore } from '#lib/sync/remoteStore';
import { isDerivedId, type SigningContext, type SigningSelf } from '#lib/sync/signedObjects';
import { getDeviceId } from '#lib/sync/ydocDevices';

const DEVICE_TAG = 'cashier-device-v1';

export const deviceRecordKey = (deviceId: string) => `devices/${deviceId}.json`;

export interface DeviceRecord {
	v: 1;
	name: string;
	/** Base64 SPKI. */
	publicKey: string;
	/** The legacy ID this device had before its ID was derived from its key. */
	previousId?: string;
	/** Signature by `publicKey` over the other fields and the ID. */
	sig: string;
}

type DeviceInfo = Omit<DeviceRecord, 'v' | 'sig'>;

const recordMessage = (id: string, info: DeviceInfo) =>
	new TextEncoder().encode(
		JSON.stringify([DEVICE_TAG, id, info.name, info.publicKey, info.previousId ?? ''])
	);

export async function signDeviceRecord(self: SigningSelf, info: DeviceInfo): Promise<DeviceRecord> {
	const record: DeviceRecord = { v: 1, name: info.name, publicKey: info.publicKey, sig: '' };
	if (info.previousId) record.previousId = info.previousId;
	record.sig = await signMessage(self.privateKey, recordMessage(self.id, record));
	return record;
}

/** The record when it is well-formed and certifies `deviceId`; null otherwise. */
export async function verifyDeviceRecord(
	deviceId: string,
	value: unknown
): Promise<DeviceRecord | null> {
	const r = value as Partial<DeviceRecord> | null;
	if (
		!r ||
		r.v !== 1 ||
		typeof r.name !== 'string' ||
		typeof r.publicKey !== 'string' ||
		typeof r.sig !== 'string' ||
		(r.previousId !== undefined && typeof r.previousId !== 'string')
	) {
		return null;
	}
	try {
		if ((await deviceIdFromPublicKey(r.publicKey)) !== deviceId) return null;
	} catch {
		return null;
	}
	const ok = await verifyMessage(r.publicKey, r.sig, recordMessage(deviceId, r as DeviceInfo));
	return ok ? (r as DeviceRecord) : null;
}

async function readRecord(remote: RemoteStore, deviceId: string): Promise<DeviceRecord | null> {
	const raw = await remote.get(deviceRecordKey(deviceId));
	if (!raw) return null;
	try {
		return await verifyDeviceRecord(deviceId, JSON.parse(new TextDecoder().decode(raw)));
	} catch {
		return null;
	}
}

/** The verified records of every device in the store, by device ID. Unverifiable ones are left out. */
export async function readDeviceRecords(remote: RemoteStore): Promise<Map<string, DeviceRecord>> {
	const out = new Map<string, DeviceRecord>();
	for (const info of await remote.list('devices/')) {
		const id = /^devices\/([^/.]+)\.json$/.exec(info.key)?.[1];
		if (!id || !isDerivedId(id)) continue;
		const record = await readRecord(remote, id).catch(() => null);
		if (record) out.set(id, record);
	}
	return out;
}

/** Publishes this device's record unless the store holds the same, valid one already. Returns whether it wrote. */
export async function publishDeviceRecord(
	remote: RemoteStore,
	self: SigningSelf,
	info: DeviceInfo
): Promise<boolean> {
	const existing = await readRecord(remote, self.id).catch(() => null);
	if (
		existing &&
		existing.name === info.name &&
		existing.publicKey === info.publicKey &&
		existing.previousId === info.previousId
	) {
		return false;
	}
	const record = await signDeviceRecord(self, info);
	return remote.put(deviceRecordKey(self.id), new TextEncoder().encode(JSON.stringify(record)));
}

/** How long a device without a record is not looked for again. */
const MISS_TTL_MS = 60_000;

/**
 * Finds the key of a device: the Trusted Devices list first, then its record in the store. Keys
 * never change for an ID, so a found one is kept; a miss is only remembered for a minute.
 */
export class DeviceDirectory {
	private remote: RemoteStore | null = null;
	private readonly misses = new Map<string, number>();

	constructor(private readonly keys: Map<string, string>) {}

	/** The store to look records up in: the final, encrypted one, as signing sits above it. */
	bind(remote: RemoteStore): void {
		this.remote = remote;
	}

	async publicKeyOf(deviceId: string): Promise<string | null> {
		const known = this.keys.get(deviceId);
		if (known) return known;
		if (!this.remote || !isDerivedId(deviceId)) return null;
		const missed = this.misses.get(deviceId);
		if (missed && Date.now() - missed < MISS_TTL_MS) return null;
		const record = await readRecord(this.remote, deviceId).catch(() => null);
		if (!record) {
			this.misses.set(deviceId, Date.now());
			return null;
		}
		this.keys.set(deviceId, record.publicKey);
		return record.publicKey;
	}
}

export interface BucketSigning {
	ctx: SigningContext;
	directory: DeviceDirectory;
}

/**
 * What signing and checking objects need on this device. While the device still has a legacy ID,
 * nothing is signed (`ctx.self` is null) and only the checks for key-derived authors apply.
 * Bind `directory` to the store that is built with it.
 */
export async function loadBucketSigning(): Promise<BucketSigning> {
	const id = await getDeviceId();
	const keys = new Map<string, string>();
	for (const peer of await db.peers.toArray()) {
		if (peer.publicKey) keys.set(peer.id, peer.publicKey);
	}
	let self: SigningSelf | null = null;
	if (isDerivedId(id)) {
		const key = await getDeviceKey();
		if ((await deviceIdFromPublicKey(key.publicKey)) === id) {
			self = { id, privateKey: key.privateKey };
			keys.set(id, key.publicKey);
		}
	}
	const directory = new DeviceDirectory(keys);
	return { ctx: { self, publicKeyOf: (deviceId) => directory.publicKeyOf(deviceId) }, directory };
}

/** What a device's record adds to a line in a device list (S3, WebDAV). All empty for a device without one. */
export interface BucketDeviceInfo {
	/** The name the device announces; the list shows this device's own label for a trusted one. */
	announcedName?: string;
	/** Base64 SPKI, to pass to `trustDevice`. */
	publicKey?: string;
	fingerprint?: string;
	/** The legacy ID the device names. */
	previousId?: string;
	/**
	 * A trusted record that trusting this device would replace: a device that switched from its
	 * legacy ID (see identityMigration.ts). Only `approve` needs a person; `rekey` is adopted by the sync.
	 */
	replaces?: { id: string; name: string; kind: 'rekey' | 'approve' };
}

export async function bucketDeviceInfo(
	deviceId: string,
	record: DeviceRecord | undefined,
	peers: TrustedPeer[]
): Promise<BucketDeviceInfo> {
	if (!record) return {};
	const match = matchLegacy(
		{ id: deviceId, publicKey: record.publicKey, previousId: record.previousId },
		peers
	);
	return {
		announcedName: record.name,
		publicKey: record.publicKey,
		fingerprint: await fingerprintOfKey(record.publicKey),
		previousId: record.previousId,
		replaces: match ? { id: match.record.id, name: match.record.name, kind: match.kind } : undefined
	};
}

/**
 * Re-keys the trusted records of devices that switched to a key-derived ID and left a record in
 * the store whose key matches (the key proves it is the same device). Returns how many. A
 * key-less record is never replaced here: that needs a person (`BucketDeviceInfo.replaces`).
 */
export async function adoptSwitchedDevices(remote: RemoteStore): Promise<number> {
	const records = await readDeviceRecords(remote);
	let adopted = 0;
	for (const [id, record] of records) {
		const peers = await db.peers.toArray();
		const match = matchLegacy(
			{ id, publicKey: record.publicKey, previousId: record.previousId },
			peers
		);
		if (match?.kind !== 'rekey') continue;
		await replaceTrustedRecord(match.record.id, {
			id,
			name: record.name,
			publicKey: record.publicKey
		});
		adopted++;
	}
	return adopted;
}

const announced = new Set<string>();

/**
 * Once per session and store: publishes this device's record (not while it has a legacy ID) and
 * adopts the devices that switched to a key-derived ID since (`adoptSwitchedDevices`), so that
 * their objects are merged under the new ID. Failures are only logged: syncing does not depend on it.
 */
export async function announceDevice(storeId: string, remote: RemoteStore): Promise<void> {
	if (announced.has(storeId)) return;
	try {
		const id = await getDeviceId();
		if (isDerivedId(id)) {
			const key = await getDeviceKey();
			const name = (await deviceSettings.get<string>(DeviceSettingKeys.peerName)) ?? 'My Device';
			const previousId =
				(await deviceSettings.get<string>(DeviceSettingKeys.previousDeviceId)) || undefined;
			await publishDeviceRecord(
				remote,
				{ id, privateKey: key.privateKey },
				{ name, publicKey: key.publicKey, previousId }
			);
		}
		await adoptSwitchedDevices(remote);
		announced.add(storeId);
	} catch (e) {
		console.warn('[device-record] Could not publish or read device records:', e);
	}
}
