/**
 * Manual sync of the app's data with an S3 bucket. See doc/projects/2026-10-05_s3-sync.md.
 * This module holds the session, keys, manifests and last-sync bookkeeping that every other
 * s3*.ts module builds on.
 *
 * Bucket layout (every object except key.json is encrypted, see s3Crypto.ts):
 * - key.json                  key-derivation parameters, shared by all devices
 * - manifests/<deviceId>.json what each device last uploaded (path -> hash, time)
 * - data/settings.json        shared settings
 * - data/files/<path>         Beancount files, by their OPFS path
 * - crdt/<xacts|scx>/snap-<ulid>.ydoc, crdt/<xacts|scx>/<deviceId>.<seq>.upd
 *                             the CRDT stores as a snapshot plus per-device deltas (see
 *                             sync/deltaSync.ts). Merged on download, so they never conflict.
 *                             The older crdt/<kind>/<deviceId>.ydoc files are still read.
 *
 * Settings and files can be changed on several devices. They are compared by content hash
 * against the last-synced hash, and a change on both sides is reported as a conflict to be
 * resolved by the user, never overwritten silently.
 *
 * The sync is split by concern:
 * - s3Files.ts        settings and Beancount files, runSync, conflicts, deletions
 * - s3CrdtSync.ts     CRDT stores: sync, status, previews, diagnostics, compaction
 * - s3FileCompare.ts  per-file status and comparison
 * - s3Status.ts       bucket overview and other devices
 * - s3Preview.ts      readable bucket objects
 */
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { getDeviceId } from '#lib/sync/ydocDevices';
import { noteBucketActivity } from '#lib/sync/lastSeen';
import { loadBucketSigning } from '#lib/sync/deviceRecords';
import { openSigned, sealSigned, type SigningContext } from '#lib/sync/signedObjects';
import type { S3Config } from './s3Config';
import { getObject, listObjectInfos, putObject } from './s3Client';
import { S3RemoteStore } from './s3RemoteStore';
import { createKeyParams, decrypt, encrypt, openKey, sha256Hex, type KeyParams } from './s3Crypto';
import type { Manifest } from './s3SyncPlan';
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
	/** Signs this device's manifest and checks the others' (see sync/signedObjects.ts). */
	signing: SigningContext;
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

export const TEXT = new TextEncoder();
export const SETTINGS_PATH = 'settings.json';
export const FILES_PREFIX = 'files/';

export const dataKey = (path: string) => `data/${path}`;
export const manifestKey = (deviceId: string) => `manifests/${deviceId}.json`;

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

async function loadManifests(
	cfg: S3Config,
	key: CryptoKey,
	signing: SigningContext
): Promise<Manifest[]> {
	const manifests: Manifest[] = [];
	const listed = await listObjectInfos(cfg, 'manifests/');
	// When each device last wrote its manifest tells when it was last seen.
	void noteBucketActivity(
		listed.map((i) => ({
			deviceId: /^manifests\/([^/.]+)\.json$/.exec(i.key)?.[1] ?? null,
			lastModified: i.lastModified
		}))
	).catch(() => undefined);
	for (const { key: objectKey } of listed) {
		try {
			const raw = await getObject(cfg, objectKey);
			if (!raw) continue;
			// A manifest not signed by its device, or forged, is ignored like an unreadable one.
			const content = await openSigned(signing, objectKey, await decrypt(key, raw));
			manifests.push(JSON.parse(new TextDecoder().decode(content)) as Manifest);
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
	const { ctx: signing, directory } = await loadBucketSigning();
	directory.bind(new S3RemoteStore(cfg, key, signing));
	const manifests = await loadManifests(cfg, key, signing);
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
		signing,
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
export function canonical(
	s: Pick<S3Session, 'bases' | 'equiv'>,
	path: string,
	hash: string | null
): string | null {
	const e = s.equiv[path];
	const base = s.bases[path];
	return hash !== null && e && base === e.base && e.hashes.includes(hash) ? base : hash;
}

/** Writes this device's manifest and the last-synced hashes, if they changed. */
export async function persist(s: S3Session): Promise<void> {
	if (s.manifestDirty) {
		s.own.updated = new Date().toISOString();
		const content = await sealSigned(
			s.signing,
			manifestKey(s.deviceId),
			TEXT.encode(JSON.stringify(s.own))
		);
		await putObject(s.cfg, manifestKey(s.deviceId), await encrypt(s.key, content));
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

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** When this device last finished an upload or download, or null if it never has. */
export async function getLastSync(): Promise<Date | null> {
	const iso = await deviceSettings.get<string>(DeviceSettingKeys.s3LastSync);
	return iso ? new Date(iso) : null;
}

export async function recordLastSync(): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.s3LastSync, new Date().toISOString());
}

export const hashOf = async (bytes: Uint8Array<ArrayBuffer> | null) =>
	bytes ? sha256Hex(bytes) : null;

/** Writes the changes that `markSameContent(..., { persist: false })` collected. */
export async function persistSession(s: S3Session): Promise<void> {
	await persist(s);
}

/** The decryption key for the configured bucket. Throws `WrongPassphraseError` on mismatch. */
export async function getSyncKey(cfg: S3Config): Promise<CryptoKey> {
	if (!cfg.passphrase) {
		throw new Error('Set an encryption passphrase in the S3 configuration first.');
	}
	return loadKey(cfg);
}
