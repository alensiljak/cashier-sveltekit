/**
 * Manual sync of the app's data with an S3 bucket. See doc/projects/2026-10-05_s3-sync.md.
 *
 * Bucket layout (every object except key.json is encrypted, see s3Crypto.ts):
 * - key.json                  key-derivation parameters, shared by all devices
 * - manifests/<deviceId>.json what each device last uploaded (path -> hash, time)
 * - data/settings.json        shared settings
 * - data/files/<path>         Beancount files, by their OPFS path
 * - crdt/xacts/<deviceId>.ydoc, crdt/scx/<deviceId>.ydoc
 *                             per-device state of the CRDT stores. Merged on download, so
 *                             they never conflict.
 *
 * Settings and files can be changed on several devices. They are compared by content hash
 * against the last-synced hash, and a change on both sides is reported as a conflict to be
 * resolved by the user, never overwritten silently.
 */
import * as Y from 'yjs';
import { CASHIER_DATA_DIR } from '$lib/constants';
import { deviceSettings, DeviceSettingKeys } from '$lib/settings';
import { exportSettingsJson, importSettingsJson } from '$lib/services/backupService';
import db from '$lib/data/db';
import { getDeviceId } from '$lib/sync/ydocDevices';
import { hasNewOps } from '$lib/sync/ydocCompare';
import { normalizeEol } from '$lib/sync/SyncSource';
import { getXactStore } from '$lib/storage/xactStoreRegistry';
import { getScxStore } from '$lib/storage/scxStoreRegistry';
import { collectExportableFiles } from '$lib/utils/opfsExport';
import { deleteFile, saveBinaryFile } from '$lib/utils/opfslib';
import type { S3Config } from './s3Config';
import { deleteObject, getObject, listObjectInfos, listObjects, putObject } from './s3Client';
import { createKeyParams, decrypt, encrypt, openKey, sha256Hex, type KeyParams } from './s3Crypto';
import {
	decide,
	isSafePath,
	latestRemote,
	TOMBSTONE,
	type Manifest,
	type SyncDirection
} from './s3SyncPlan';

export type SyncItem = 'settings' | 'scheduled' | 'xacts' | 'beancount';

export type SyncOutcome =
	| 'uploaded'
	| 'downloaded'
	| 'deleted'
	| 'merged'
	| 'pending-delete'
	| 'unchanged'
	| 'skipped'
	| 'conflict'
	| 'error';

export interface SyncLine {
	item: SyncItem;
	/** Logical path, e.g. `files/2024/main.bean`, or a CRDT object key. */
	path: string;
	outcome: SyncOutcome;
	message?: string;
	/** For `pending-delete`: where the file would be deleted. */
	deletes?: 'bucket' | 'device';
}

export interface S3Session {
	cfg: S3Config;
	key: CryptoKey;
	deviceId: string;
	/** All devices' manifests, including this device's own. */
	manifests: Manifest[];
	own: Manifest;
	/** path -> hash at the last sync. */
	bases: Record<string, string>;
	/** path -> hashes verified to hold the same text as `base`. Void once the base changes. */
	equiv: Record<string, Equivalent>;
	manifestDirty: boolean;
	basesDirty: boolean;
	equivDirty: boolean;
}

interface Equivalent {
	base: string;
	hashes: string[];
}

const TEXT = new TextEncoder();
const SETTINGS_PATH = 'settings.json';
const FILES_PREFIX = 'files/';

const dataKey = (path: string) => `data/${path}`;
const manifestKey = (deviceId: string) => `manifests/${deviceId}.json`;

// --- session ---

async function loadKey(cfg: S3Config): Promise<CryptoKey> {
	const read = async (): Promise<KeyParams | null> => {
		const raw = await getObject(cfg, 'key.json');
		return raw ? (JSON.parse(new TextDecoder().decode(raw)) as KeyParams) : null;
	};

	let params = await read();
	if (!params) {
		const created = await createKeyParams(cfg.passphrase);
		const won = await putObject(cfg, 'key.json', JSON.stringify(created.params), {
			contentType: 'application/json',
			onlyIfAbsent: true
		});
		if (won) return created.key;
		// Another device created it first; use theirs.
		params = await read();
		if (!params) throw new Error('Could not create the encryption key file in the bucket.');
	}
	return openKey(cfg.passphrase, params);
}

async function loadManifests(cfg: S3Config, key: CryptoKey): Promise<Manifest[]> {
	const manifests: Manifest[] = [];
	for (const objectKey of await listObjects(cfg, 'manifests/')) {
		try {
			const raw = await getObject(cfg, objectKey);
			if (!raw) continue;
			manifests.push(JSON.parse(new TextDecoder().decode(await decrypt(key, raw))) as Manifest);
		} catch (e) {
			console.warn('[s3-sync] Ignoring unreadable manifest', objectKey, e);
		}
	}
	return manifests;
}

/**
 * Connects to the bucket: creates the encryption key parameters on first use, or checks the
 * passphrase against them, then reads all manifests. Throws `WrongPassphraseError` on mismatch.
 */
export async function openSession(cfg: S3Config): Promise<S3Session> {
	if (!cfg.passphrase) {
		throw new Error('Set an encryption passphrase in the S3 configuration first.');
	}
	const key = await loadKey(cfg);
	const deviceId = await getDeviceId();
	const manifests = await loadManifests(cfg, key);
	let own = manifests.find((m) => m.deviceId === deviceId);
	if (!own) {
		own = { deviceId, updated: '', files: {} };
		manifests.push(own);
	}
	const bases =
		(await deviceSettings.get<Record<string, string>>(DeviceSettingKeys.s3SyncBase)) ?? {};
	const equiv =
		(await deviceSettings.get<Record<string, Equivalent>>(DeviceSettingKeys.s3SyncEquiv)) ?? {};
	return {
		cfg,
		key,
		deviceId,
		manifests,
		own,
		bases,
		equiv,
		manifestDirty: false,
		basesDirty: false,
		equivDirty: false
	};
}

/**
 * A hash verified to hold the same text as the last-synced version counts as that version, so
 * that a copy differing only in line endings is not taken for a change.
 */
function canonical(
	s: Pick<S3Session, 'bases' | 'equiv'>,
	path: string,
	hash: string | null
): string | null {
	const e = s.equiv[path];
	const base = s.bases[path];
	return hash !== null && e && base === e.base && e.hashes.includes(hash) ? base : hash;
}

/** Writes this device's manifest and the last-synced hashes, if they changed. */
async function persist(s: S3Session): Promise<void> {
	if (s.manifestDirty) {
		s.own.updated = new Date().toISOString();
		const body = await encrypt(s.key, TEXT.encode(JSON.stringify(s.own)));
		await putObject(s.cfg, manifestKey(s.deviceId), body);
		s.manifestDirty = false;
	}
	if (s.basesDirty) {
		await deviceSettings.set(DeviceSettingKeys.s3SyncBase, s.bases);
		s.basesDirty = false;
	}
	if (s.equivDirty) {
		await deviceSettings.set(DeviceSettingKeys.s3SyncEquiv, s.equiv);
		s.equivDirty = false;
	}
}

// --- shared files (settings, Beancount files) ---

interface SharedFile {
	item: SyncItem;
	path: string;
	read(): Promise<Uint8Array<ArrayBuffer> | null>;
	write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
	/** Deletes the local file. Absent for files that are never deleted (settings). */
	remove?(): Promise<void>;
}

type LocalFiles = Map<string, FileSystemFileHandle>;

async function listLocalFiles(): Promise<LocalFiles> {
	const map: LocalFiles = new Map();
	for (const e of await collectExportableFiles()) {
		if (e.path.startsWith(CASHIER_DATA_DIR)) continue;
		map.set(e.path, e.handle);
	}
	return map;
}

const settingsFile = (): SharedFile => ({
	item: 'settings',
	path: SETTINGS_PATH,
	read: async () => TEXT.encode(await exportSettingsJson()),
	write: async (bytes) => importSettingsJson(new TextDecoder().decode(bytes))
});

function beancountFile(path: string, local: LocalFiles): SharedFile {
	const opfsPath = path.slice(FILES_PREFIX.length);
	return {
		item: 'beancount',
		path,
		read: async () => {
			const handle = local.get(opfsPath);
			return handle ? new Uint8Array(await (await handle.getFile()).arrayBuffer()) : null;
		},
		write: (bytes) => saveBinaryFile(opfsPath, bytes),
		remove: async () => {
			if (!(await deleteFile(opfsPath))) throw new Error('Could not delete the local file');
		}
	};
}

/** Removes the file from the bucket and records a tombstone, so other devices learn of it. */
async function deleteShared(s: S3Session, file: SharedFile): Promise<void> {
	await deleteObject(s.cfg, dataKey(file.path));
	s.own.files[file.path] = { hash: TOMBSTONE, at: new Date().toISOString() };
	delete s.bases[file.path];
	s.manifestDirty = s.basesDirty = true;
}

/** Deletes the local file and forgets its last-synced hash. */
async function removeLocal(s: S3Session, file: SharedFile): Promise<void> {
	if (!file.remove) throw new Error('This file is never deleted');
	await file.remove();
	delete s.bases[file.path];
	s.basesDirty = true;
}

async function putShared(s: S3Session, file: SharedFile, bytes: Uint8Array<ArrayBuffer>) {
	await putObject(s.cfg, dataKey(file.path), await encrypt(s.key, bytes));
	const hash = await sha256Hex(bytes);
	s.own.files[file.path] = { hash, at: new Date().toISOString() };
	s.bases[file.path] = hash;
	s.manifestDirty = s.basesDirty = true;
}

async function getShared(s: S3Session, file: SharedFile): Promise<void> {
	const raw = await getObject(s.cfg, dataKey(file.path));
	if (!raw) throw new Error('Listed in a manifest but missing from the bucket');
	const bytes = await decrypt(s.key, raw);
	await file.write(bytes);
	s.bases[file.path] = await sha256Hex(bytes);
	s.basesDirty = true;
}

/**
 * True when the bucket's copy of a text file equals the local one apart from line endings and the
 * final newline, which differ between Windows, Android and editors. Costs one download.
 */
async function sameText(s: S3Session, file: SharedFile, local: Uint8Array): Promise<boolean> {
	const raw = await getObject(s.cfg, dataKey(file.path));
	if (!raw) return false;
	const remote = await decrypt(s.key, raw);
	const text = (b: Uint8Array) => normalizeEol(new TextDecoder().decode(b));
	return text(remote) === text(local);
}
async function syncShared(
	s: S3Session,
	direction: SyncDirection,
	file: SharedFile
): Promise<SyncLine> {
	const { item, path } = file;
	try {
		const bytes = await file.read();
		const local = canonical(s, path, bytes ? await sha256Hex(bytes) : null);
		const remote = canonical(s, path, latestRemote(s.manifests).get(path)?.hash ?? null);
		let d = decide(direction, local, remote, s.bases[path] ?? null);

		if (
			d.action === 'conflict' &&
			item === 'beancount' &&
			bytes &&
			(await sameText(s, file, bytes))
		) {
			// Only line endings differ: not a real conflict. Make both sides hold the same bytes.
			d = { action: direction };
		}

		switch (d.action) {
			case 'upload':
				await putShared(s, file, bytes!);
				return { item, path, outcome: 'uploaded' };
			case 'download':
				await getShared(s, file);
				return { item, path, outcome: 'downloaded' };
			case 'delete-remote':
				return { item, path, outcome: 'pending-delete', message: d.reason, deletes: 'bucket' };
			case 'delete-local':
				return { item, path, outcome: 'pending-delete', message: d.reason, deletes: 'device' };
			case 'unchanged':
				// Equal on both sides: remember it, so a later change on one side is not a conflict.
				if (local && s.bases[path] !== local) {
					s.bases[path] = local;
					s.basesDirty = true;
				}
				// Gone on both sides: nothing left to compare against.
				if (!local && s.bases[path]) {
					delete s.bases[path];
					s.basesDirty = true;
				}
				return { item, path, outcome: 'unchanged' };
			case 'skip':
				return { item, path, outcome: 'skipped', message: d.reason };
			case 'conflict':
				return { item, path, outcome: 'conflict', message: d.reason };
		}
	} catch (e) {
		return { item, path, outcome: 'error', message: e instanceof Error ? e.message : String(e) };
	}
}

// --- CRDT stores (transactions, scheduled transactions) ---

/** Device ID in a `crdt/<kind>/<deviceId>.ydoc` object key, or null. */
const deviceIdOfKey = (objectKey: string): string | null =>
	/\/([^/]+)\.ydoc$/.exec(objectKey)?.[1] ?? null;

/** Why another device's CRDT state is not merged here: not on the Trusted Devices list, or read-only. */
async function loadIgnoreReasons(): Promise<(deviceId: string | null) => string | null> {
	const peers = new Map((await db.peers.toArray()).map((p) => [p.id, p]));
	return (deviceId) => {
		const peer = deviceId ? peers.get(deviceId) : undefined;
		if (!peer) return 'Device not trusted';
		return peer.readOnly ? 'Device is read-only' : null;
	};
}

interface CrdtStoreLike {
	isInitialized(): Promise<boolean>;
	exportState(): Promise<Uint8Array>;
	importState(update: Uint8Array, opts?: { backup?: boolean }): Promise<unknown[]>;
}

async function syncCrdt(
	s: Pick<S3Session, 'cfg' | 'key' | 'deviceId'>,
	direction: SyncDirection,
	item: 'xacts' | 'scheduled'
): Promise<SyncLine[]> {
	const kind = item === 'xacts' ? 'xacts' : 'scx';
	const prefix = `crdt/${kind}/`;
	const ownKey = `${prefix}${s.deviceId}.ydoc`;
	const lines: SyncLine[] = [];

	try {
		const store: CrdtStoreLike = item === 'xacts' ? await getXactStore() : await getScxStore();

		if (direction === 'upload') {
			// A background action must not create the scheduled-transactions store: that would
			// pre-empt its first-launch migration prompt (see webdavAutoBackupService).
			if (item === 'scheduled' && !(await store.isInitialized())) {
				return [{ item, path: ownKey, outcome: 'skipped', message: 'Not set up on this device' }];
			}
			const state = (await store.exportState()) as Uint8Array<ArrayBuffer>;
			await putObject(s.cfg, ownKey, await encrypt(s.key, state));
			return [{ item, path: ownKey, outcome: 'uploaded' }];
		}

		const keys = (await listObjects(s.cfg, prefix)).filter((k) => k !== ownKey);
		if (!keys.length) {
			return [
				{ item, path: prefix, outcome: 'skipped', message: 'No other device has uploaded yet' }
			];
		}
		const ignoreReason = await loadIgnoreReasons();
		for (const key of keys) {
			const reason = ignoreReason(deviceIdOfKey(key));
			if (reason) {
				lines.push({ item, path: key, outcome: 'skipped', message: reason });
				continue;
			}
			try {
				const raw = await getObject(s.cfg, key);
				if (!raw) continue;
				// The bucket already holds what it returns: no need to re-upload it as our own.
				const changes = await store.importState(await decrypt(s.key, raw), { backup: false });
				lines.push({
					item,
					path: key,
					outcome: changes.length ? 'downloaded' : 'unchanged',
					message: changes.length ? `${changes.length} changes merged` : undefined
				});
			} catch (e) {
				lines.push({ item, path: key, outcome: 'error', message: errorText(e) });
			}
		}
	} catch (e) {
		lines.push({ item, path: prefix, outcome: 'error', message: errorText(e) });
	}
	return lines;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// --- entry points ---

/**
 * Uploads or downloads the selected items. Files that changed on both sides are left alone and
 * returned as `conflict` lines; resolve them with `resolveConflict`.
 */
export async function runSync(
	s: S3Session,
	direction: SyncDirection,
	items: SyncItem[]
): Promise<SyncLine[]> {
	const lines: SyncLine[] = [];

	for (const item of items) {
		if (item === 'xacts' || item === 'scheduled') {
			lines.push(...(await syncCrdt(s, direction, item)));
		}
	}

	if (items.includes('settings')) {
		lines.push(await syncShared(s, direction, settingsFile()));
	}

	if (items.includes('beancount')) {
		const local = await listLocalFiles();
		const paths = new Set([...local.keys()].map((p) => FILES_PREFIX + p));
		for (const p of latestRemote(s.manifests).keys()) {
			if (p.startsWith(FILES_PREFIX)) paths.add(p);
		}
		for (const path of [...paths].sort()) {
			if (!isSafePath(path.slice(FILES_PREFIX.length))) {
				lines.push({
					item: 'beancount',
					path,
					outcome: 'error',
					message: 'Unsafe file path, ignored'
				});
				continue;
			}
			lines.push(await syncShared(s, direction, beancountFile(path, local)));
		}
	}

	await persist(s);
	if (!lines.some((l) => l.outcome === 'error')) await recordLastSync();
	return lines;
}

/**
 * Uploads this device's CRDT state (transactions, scheduled transactions) for the automatic
 * backup. Needs only the key, not the manifests, and never conflicts: each device owns its file.
 * Resolves to the lines that failed (empty on success).
 */
export async function backupCrdtStores(cfg: S3Config): Promise<SyncLine[]> {
	const session = await crdtSession(cfg);
	const lines = [
		...(await syncCrdt(session, 'upload', 'xacts')),
		...(await syncCrdt(session, 'upload', 'scheduled'))
	];
	return lines.filter((l) => l.outcome === 'error');
}

type CrdtSession = Pick<S3Session, 'cfg' | 'key' | 'deviceId'>;

/**
 * True when the bucket and this device differ in a CRDT store: another device has records not
 * merged here, or this device has records its own bucket file lacks.
 */
async function crdtDiffers(s: CrdtSession, item: 'xacts' | 'scheduled'): Promise<boolean> {
	const { upload, download } = await crdtStatus(s, item);
	return upload || download;
}

/**
 * Compares a CRDT store with the bucket by Yjs state vectors, independent of any sync time:
 * `upload` = this device has records its own bucket file lacks; `download` = a trusted device's
 * file has records not merged here.
 */
async function crdtStatus(
	s: CrdtSession,
	item: 'xacts' | 'scheduled'
): Promise<{ upload: boolean; download: boolean }> {
	const kind = item === 'xacts' ? 'xacts' : 'scx';
	const prefix = `crdt/${kind}/`;
	const ownKey = `${prefix}${s.deviceId}.ydoc`;
	const store: CrdtStoreLike = item === 'xacts' ? await getXactStore() : await getScxStore();
	if (item === 'scheduled' && !(await store.isInitialized())) {
		return { upload: false, download: false };
	}

	const local = await store.exportState();
	let own: Uint8Array | undefined;
	const others: Uint8Array[] = [];
	let download = false;
	const ignoreReason = await loadIgnoreReasons();
	for (const key of await listObjects(s.cfg, prefix)) {
		if (key !== ownKey && ignoreReason(deviceIdOfKey(key))) continue;
		const raw = await getObject(s.cfg, key);
		if (!raw) continue;
		const remote = await decrypt(s.key, raw);
		if (key === ownKey) {
			own = remote;
		} else {
			others.push(remote);
			if (hasNewOps(remote, local)) download = true;
		}
	}
	// Records merged from other devices are already in the bucket, in their files, so only
	// operations found in no bucket file count as something to upload.
	const files = own ? [own, ...others] : others;
	const upload = hasNewOps(local, files.length ? Y.mergeUpdates(files) : undefined);
	return { upload, download };
}

export interface CrdtSyncStatus {
	upload: boolean;
	download: boolean;
}

/** Dry run for the CRDT stores, per item. Decrypts the state files, so it needs the passphrase. */
export async function fetchCrdtSyncStatus(
	cfg: S3Config
): Promise<Record<'scheduled' | 'xacts', CrdtSyncStatus>> {
	const s = await crdtSession(cfg);
	return {
		scheduled: await crdtStatus(s, 'scheduled'),
		xacts: await crdtStatus(s, 'xacts')
	};
}

async function crdtSession(cfg: S3Config): Promise<CrdtSession> {
	return { cfg, key: await getSyncKey(cfg), deviceId: await getDeviceId() };
}

/** Compares the CRDT stores with the bucket without changing anything. True = they differ. */
export async function checkCrdtStores(cfg: S3Config): Promise<boolean> {
	const s = await crdtSession(cfg);
	return (await crdtDiffers(s, 'xacts')) || (await crdtDiffers(s, 'scheduled'));
}

/**
 * Full sync of the CRDT stores: merges the other devices' state, then uploads this device's.
 * Returns the failed lines and whether records were merged in (the ledger then needs a reload).
 */
export async function syncCrdtStores(
	cfg: S3Config
): Promise<{ errors: SyncLine[]; merged: boolean }> {
	const s = await crdtSession(cfg);
	const down = [
		...(await syncCrdt(s, 'download', 'xacts')),
		...(await syncCrdt(s, 'download', 'scheduled'))
	];
	const up = [
		...(await syncCrdt(s, 'upload', 'xacts')),
		...(await syncCrdt(s, 'upload', 'scheduled'))
	];
	const errors = [...down, ...up].filter((l) => l.outcome === 'error');
	if (!errors.length) await recordLastSync();
	return {
		errors,
		merged: down.some((l) => l.outcome === 'downloaded' && l.item === 'xacts')
	};
}

/** Settles a conflict: `local` overwrites the bucket's version, `remote` overwrites this device's. */
export async function resolveConflict(
	s: S3Session,
	line: SyncLine,
	keep: 'local' | 'remote'
): Promise<SyncLine> {
	const file = await sharedFileFor(line);
	const { item, path } = line;
	try {
		const bytes = await file.read();
		const remoteDeleted = latestRemote(s.manifests).get(path)?.hash === TOMBSTONE;
		let outcome: SyncOutcome;

		if (keep === 'local') {
			// A file deleted here is deleted in the bucket too; otherwise this version wins.
			if (bytes) {
				await putShared(s, file, bytes);
				outcome = 'uploaded';
			} else {
				await deleteShared(s, file);
				outcome = 'deleted';
			}
		} else if (remoteDeleted) {
			await removeLocal(s, file);
			outcome = 'deleted';
		} else {
			await getShared(s, file);
			outcome = 'downloaded';
		}
		await persist(s);
		return { item, path, outcome };
	} catch (e) {
		return { item, path, outcome: 'error', message: errorText(e) };
	}
}

/**
 * Writes a partial or full merge to this device only. Neither the bucket nor the last-synced
 * hash is touched, so the file keeps its status: still a conflict while it differs from the
 * bucket, and the remaining differences can be merged (or kept) later.
 */
export async function applyMerge(path: string, content: string): Promise<SyncLine> {
	const line: SyncLine = { item: 'beancount', path: FILES_PREFIX + path, outcome: 'merged' };
	try {
		if (!isSafePath(path)) throw new Error('Unsafe file path');
		await saveBinaryFile(path, TEXT.encode(content));
		return line;
	} catch (e) {
		return { ...line, outcome: 'error', message: errorText(e) };
	}
}

async function sharedFileFor(line: SyncLine): Promise<SharedFile> {
	return line.item === 'settings'
		? settingsFile()
		: beancountFile(line.path, await listLocalFiles());
}

/** Applies a `pending-delete` line the user has confirmed. */
export async function applyDeletion(s: S3Session, line: SyncLine): Promise<SyncLine> {
	const { item, path } = line;
	try {
		const file = await sharedFileFor(line);
		if (line.deletes === 'bucket') await deleteShared(s, file);
		else await removeLocal(s, file);
		await persist(s);
		return { item, path, outcome: 'deleted' };
	} catch (e) {
		return { item, path, outcome: 'error', message: errorText(e) };
	}
}

// --- status ---

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
				.filter((i) => !i.key.endsWith(`/${deviceId}.ydoc`) && !ignoreReason(deviceIdOfKey(i.key)))
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
}

/** Other devices that have uploaded CRDT state to the bucket, by a plain listing (no passphrase needed). */
export async function listBucketDevices(cfg: S3Config): Promise<BucketDevice[]> {
	const [selfId, peers, xacts, scx] = await Promise.all([
		getDeviceId(),
		db.peers.toArray(),
		listObjectInfos(cfg, 'crdt/xacts/'),
		listObjectInfos(cfg, 'crdt/scx/')
	]);
	const found = new Map<string, Date | null>();
	for (const i of [...xacts, ...scx]) {
		const id = deviceIdOfKey(i.key);
		if (!id || id === selfId) continue;
		found.set(id, newest([found.get(id) ?? null, i.lastModified]));
	}
	return [...found]
		.map(([deviceId, lastModified]) => {
			const peer = peers.find((p) => p.id === deviceId);
			return {
				deviceId,
				lastModified,
				name: peer?.name,
				trusted: !!peer,
				readOnly: !!peer?.readOnly
			};
		})
		.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

/** When this device last finished an upload or download, or null if it never has. */
export async function getLastSync(): Promise<Date | null> {
	const iso = await deviceSettings.get<string>(DeviceSettingKeys.s3LastSync);
	return iso ? new Date(iso) : null;
}

async function recordLastSync(): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.s3LastSync, new Date().toISOString());
}

/** Whether a file-based item differs between this device and the bucket, and which way. */
export interface FileSyncStatus {
	/** Files that exist or changed here and would be uploaded (or deleted from the bucket). */
	upload: number;
	/** Files that are newer in the bucket and would be downloaded (or deleted here). */
	download: number;
	conflict: number;
}

export type FileSyncOverview = Record<'settings' | 'beancount', FileSyncStatus>;

/** What an upload or download would do per path, in the same terms as `decide`. */
function classify(
	local: string | null,
	remote: string | null,
	base: string | null
): { kind: 'upload' | 'download' | 'conflict'; reason?: string } | null {
	const up = decide('upload', local, remote, base);
	const down = decide('download', local, remote, base);
	if (up.action === 'unchanged') return null;
	if (up.action === 'conflict') return { kind: 'conflict', reason: up.reason };
	if (down.action === 'conflict') return { kind: 'conflict', reason: down.reason };
	if (up.action === 'upload' || up.action === 'delete-remote') {
		return { kind: 'upload', reason: up.reason };
	}
	if (down.action === 'download' || down.action === 'delete-local') {
		return { kind: 'download', reason: down.reason };
	}
	return null;
}

export type FileState = 'unchanged' | 'upload' | 'download' | 'conflict';

export interface FileStatusEntry {
	/** OPFS path of the Beancount file. */
	path: string;
	state: FileState;
	reason?: string;
	/** Present on this device. */
	local: boolean;
	/** In the bucket, and not deleted there. */
	remote: boolean;
}

const hashOf = async (bytes: Uint8Array<ArrayBuffer> | null) => (bytes ? sha256Hex(bytes) : null);

/**
 * Status of every Beancount file, local or in the bucket, in the terms of `decide`. Unlike
 * `fetchFileSyncStatus` it lists the unchanged files too.
 */
export async function listFileStatuses(s: S3Session): Promise<FileStatusEntry[]> {
	const remote = latestRemote(s.manifests);
	const local = await listLocalFiles();
	const paths = new Set([...local.keys()].map((p) => FILES_PREFIX + p));
	for (const p of remote.keys()) if (p.startsWith(FILES_PREFIX)) paths.add(p);

	const entries: FileStatusEntry[] = [];
	for (const path of [...paths].sort()) {
		const opfsPath = path.slice(FILES_PREFIX.length);
		if (!isSafePath(opfsPath)) continue;
		const bytes = await beancountFile(path, local).read();
		const remoteHash = remote.get(path)?.hash ?? null;
		const verdict = classify(
			canonical(s, path, await hashOf(bytes)),
			canonical(s, path, remoteHash),
			s.bases[path] ?? null
		);
		const inBucket = remoteHash !== null && remoteHash !== TOMBSTONE;
		// Gone from both sides: nothing to show.
		if (!bytes && !inBucket) continue;
		entries.push({
			path: opfsPath,
			state: verdict?.kind ?? 'unchanged',
			reason: verdict?.reason,
			local: !!bytes,
			remote: inBucket
		});
	}
	return entries;
}

export interface FileComparison {
	path: string;
	/** Null when the file does not exist on this device. */
	localText: string | null;
	/** Null when the file is absent from the bucket or deleted there. */
	remoteText: string | null;
	localHash: string | null;
	remoteHash: string | null;
	/** Byte for byte the same. */
	identical: boolean;
	/** The same text, ignoring line endings and the final newline. */
	sameText: boolean;
}

/** Reads both versions of a Beancount file, to see whether they really differ. */
export async function compareFile(s: S3Session, path: string): Promise<FileComparison> {
	const full = FILES_PREFIX + path;
	if (!isSafePath(path)) throw new Error('Unsafe file path');
	const localBytes = await beancountFile(full, await listLocalFiles()).read();

	const entry = latestRemote(s.manifests).get(full);
	let remoteBytes: Uint8Array<ArrayBuffer> | null = null;
	if (entry && entry.hash !== TOMBSTONE) {
		const raw = await getObject(s.cfg, dataKey(full));
		if (!raw) throw new Error('Listed in a manifest but missing from the bucket');
		remoteBytes = await decrypt(s.key, raw);
	}

	const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
	const localHash = await hashOf(localBytes);
	const remoteHash = await hashOf(remoteBytes);
	const localText = text(localBytes);
	const remoteText = text(remoteBytes);
	return {
		path,
		localText,
		remoteText,
		localHash,
		remoteHash,
		identical: localHash !== null && localHash === remoteHash,
		sameText:
			localText !== null &&
			remoteText !== null &&
			normalizeEol(localText) === normalizeEol(remoteText)
	};
}

/**
 * Records that this device's copy and the bucket's hold the same text, so the file stops showing
 * as a conflict. Changes nothing in the bucket or in the files. A later change on either side is
 * detected as usual.
 */
export async function markSameContent(s: S3Session, cmp: FileComparison): Promise<void> {
	if (!cmp.sameText || !cmp.localHash || !cmp.remoteHash) {
		throw new Error('The two versions differ');
	}
	const path = FILES_PREFIX + cmp.path;
	const manifestHash = latestRemote(s.manifests).get(path)?.hash;
	// Byte-identical copies are safe to mark even when the manifest records another hash: that
	// stale hash is what shows the file as changed, so it counts as the same version too.
	if (manifestHash !== cmp.remoteHash && !cmp.identical) {
		throw new Error('The bucket copy no longer matches its manifest. Refresh and compare again.');
	}
	const hashes = [cmp.remoteHash];
	if (manifestHash && manifestHash !== TOMBSTONE && !hashes.includes(manifestHash)) {
		hashes.push(manifestHash);
	}
	s.bases[path] = cmp.localHash;
	s.equiv[path] = { base: cmp.localHash, hashes };
	s.basesDirty = s.equivDirty = true;
	await persist(s);
}

/**
 * Dry run for Settings and Beancount files: compares local hashes with the newest manifest
 * entries and the last-synced hashes, without writing anything. Decrypts the manifests, so it
 * needs the passphrase.
 */
export async function fetchFileSyncStatus(cfg: S3Config): Promise<FileSyncOverview> {
	const s = await openSession(cfg);
	const remote = latestRemote(s.manifests);
	const result: FileSyncOverview = {
		settings: { upload: 0, download: 0, conflict: 0 },
		beancount: { upload: 0, download: 0, conflict: 0 }
	};
	const settings = await settingsFile().read();
	const verdict = classify(
		canonical(s, SETTINGS_PATH, await hashOf(settings)),
		canonical(s, SETTINGS_PATH, remote.get(SETTINGS_PATH)?.hash ?? null),
		s.bases[SETTINGS_PATH] ?? null
	);
	if (verdict) result.settings[verdict.kind]++;

	for (const f of await listFileStatuses(s)) {
		if (f.state !== 'unchanged') result.beancount[f.state]++;
	}
	return result;
}

// --- preview ---

/** The decryption key for the configured bucket. Throws `WrongPassphraseError` on mismatch. */
export async function getSyncKey(cfg: S3Config): Promise<CryptoKey> {
	if (!cfg.passphrase) {
		throw new Error('Set an encryption passphrase in the S3 configuration first.');
	}
	return loadKey(cfg);
}

/**
 * Readable content of a bucket object, decrypted on the fly. Yjs state files are shown as the
 * records they hold. Files that are not text are described instead of shown.
 */
export async function previewObject(
	cfg: S3Config,
	key: CryptoKey,
	objectKey: string
): Promise<string> {
	const raw = await getObject(cfg, objectKey);
	if (!raw) throw new Error('The object no longer exists');
	// key.json holds only key-derivation parameters and is not encrypted.
	const bytes = objectKey === 'key.json' ? raw : await decrypt(key, raw);

	if (objectKey.endsWith('.ydoc')) {
		const doc = new Y.Doc();
		Y.applyUpdate(doc, bytes);
		const out: Record<string, unknown> = {};
		for (const name of doc.share.keys()) out[name] = doc.getMap(name).toJSON();
		return JSON.stringify(out, null, 2);
	}

	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return `[Binary content, ${bytes.length} bytes]`;
	}
	if (objectKey.endsWith('.json')) {
		try {
			return JSON.stringify(JSON.parse(text), null, 2);
		} catch {
			// Show it as it is.
		}
	}
	return text;
}
