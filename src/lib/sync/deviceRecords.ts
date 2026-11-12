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
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import {
	deviceIdFromPublicKey,
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

const announced = new Set<string>();

/**
 * Publishes this device's record to a store, once per session and store. Does nothing while the
 * device has a legacy ID. Failures are only logged: syncing does not depend on it.
 */
export async function announceDevice(storeId: string, remote: RemoteStore): Promise<void> {
	if (announced.has(storeId)) return;
	try {
		const id = await getDeviceId();
		if (!isDerivedId(id)) return;
		const key = await getDeviceKey();
		const name = (await deviceSettings.get<string>(DeviceSettingKeys.peerName)) ?? 'My Device';
		const previousId =
			(await deviceSettings.get<string>(DeviceSettingKeys.previousDeviceId)) || undefined;
		await publishDeviceRecord(
			remote,
			{ id, privateKey: key.privateKey },
			{ name, publicKey: key.publicKey, previousId }
		);
		announced.add(storeId);
	} catch (e) {
		console.warn('[device-record] Could not publish this device:', e);
	}
}
