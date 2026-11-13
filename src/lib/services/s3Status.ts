/**
 * What the bucket holds and who else uses it, from plain listings. Needs no passphrase except
 * for device names and fingerprints.
 */
import db from '#lib/data/db';
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { getDeviceId } from '#lib/sync/ydocDevices';
import { loadIgnoreReasons } from '#lib/sync/deltaSyncRegistry';
import {
	bucketDeviceInfo,
	loadBucketSigning,
	readDeviceRecords,
	type BucketDeviceInfo,
	type DeviceRecord
} from '#lib/sync/deviceRecords';
import { peerOf } from '#lib/sync/identityMigration';
import { listObjectInfos } from './s3Client';
import type { S3Config } from './s3Config';
import { S3RemoteStore } from './s3RemoteStore';
import { deviceIdOfKey } from './s3CrdtSync';
import { dataKey, FILES_PREFIX, getSyncKey, SETTINGS_PATH } from './s3Session';
export interface RemoteItemStatus {
	/** Newest server-side modification among the item's objects. */
	lastModified: Date | null;
	/** Objects (files, or per-device state files) behind the item. */
	count: number;
	/** CRDT items: the newest upload by another device, if any. */
	otherDeviceModified?: Date | null;
}

export interface RemoteOverview {
	settings: RemoteItemStatus;
	scheduled: RemoteItemStatus;
	xacts: RemoteItemStatus;
	beancount: RemoteItemStatus;
}

const newest = (dates: (Date | null)[]): Date | null =>
	dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

/**
 * What the bucket holds and when it last changed, from a plain listing. Needs no passphrase and
 * decrypts nothing.
 */
export async function fetchRemoteOverview(cfg: S3Config): Promise<RemoteOverview> {
	const deviceId = await getDeviceId();
	const ignoreReason = await loadIgnoreReasons();
	const [data, xacts, scx] = await Promise.all([
		listObjectInfos(cfg, 'data/'),
		listObjectInfos(cfg, 'crdt/xacts/'),
		listObjectInfos(cfg, 'crdt/scx/')
	]);

	// Only devices whose data would be merged count as "other devices".
	const crdt = (infos: typeof xacts): RemoteItemStatus => ({
		lastModified: newest(infos.map((i) => i.lastModified)),
		count: infos.length,
		otherDeviceModified: newest(
			infos
				.filter((i) => {
					const writer = deviceIdOfKey(i.key);
					return writer !== null && writer !== deviceId && !ignoreReason(writer);
				})
				.map((i) => i.lastModified)
		)
	});
	const files = data.filter((i) => i.key.startsWith(dataKey(FILES_PREFIX)));
	const settings = data.filter((i) => i.key === dataKey(SETTINGS_PATH));

	return {
		settings: { lastModified: newest(settings.map((i) => i.lastModified)), count: settings.length },
		scheduled: crdt(scx),
		xacts: crdt(xacts),
		beancount: { lastModified: newest(files.map((i) => i.lastModified)), count: files.length }
	};
}

export interface BucketDevice {
	deviceId: string;
	lastModified: Date | null;
	/** Name from the Trusted Devices list, when trusted. */
	name?: string;
	trusted: boolean;
	readOnly: boolean;
	/** Short fingerprint of its key, from the trusted record or its device record. */
	fingerprint?: string;
	/** What it announces in its device record (see `BucketDeviceInfo`). */
	announcedName?: string;
	publicKey?: string;
	previousId?: string;
	replaces?: BucketDeviceInfo['replaces'];
}

/** The verified device records in the bucket; none without the passphrase or when it cannot be read. */
async function bucketRecords(cfg: S3Config): Promise<Map<string, DeviceRecord>> {
	if (!cfg.passphrase) return new Map();
	try {
		const key = await getSyncKey(cfg);
		const { ctx, directory } = await loadBucketSigning();
		const remote = new S3RemoteStore(cfg, key, ctx);
		directory.bind(remote);
		return await readDeviceRecords(remote);
	} catch {
		return new Map();
	}
}

/**
 * Other devices that have uploaded CRDT state to the bucket. The objects are found by a plain
 * listing; a device's name and fingerprint come from its device record, which needs the passphrase.
 */
export async function listBucketDevices(cfg: S3Config): Promise<BucketDevice[]> {
	const [selfId, previousId, peers, xacts, scx, records] = await Promise.all([
		getDeviceId(),
		deviceSettings.get<string>(DeviceSettingKeys.previousDeviceId),
		db.peers.toArray(),
		listObjectInfos(cfg, 'crdt/xacts/'),
		listObjectInfos(cfg, 'crdt/scx/'),
		bucketRecords(cfg)
	]);
	const found = new Map<string, Date | null>();
	for (const i of [...xacts, ...scx]) {
		const id = deviceIdOfKey(i.key);
		// What this device wrote under its legacy ID is its own.
		if (!id || id === selfId || id === previousId) continue;
		found.set(id, newest([found.get(id) ?? null, i.lastModified]));
	}
	const devices: BucketDevice[] = [];
	for (const [deviceId, lastModified] of found) {
		const peer = peerOf(peers, deviceId);
		const info = await bucketDeviceInfo(deviceId, records.get(deviceId), peers);
		devices.push({
			deviceId,
			lastModified,
			name: peer?.name,
			trusted: !!peer,
			readOnly: !!peer?.readOnly,
			...info,
			fingerprint: peer?.fingerprint || info.fingerprint
		});
	}
	return devices.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}
