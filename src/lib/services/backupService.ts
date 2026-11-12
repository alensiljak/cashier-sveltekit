/*
    Backup Service
	Backup and restore custom data using a JSON file.

	The file is versioned (`version`, see BACKUP_VERSION). Version 1 files (no `version`) hold only
	`settings` and `scx`. Version 2 adds optional sections, each chosen when the backup is made:

	- settings:   the shared settings (secret fields blanked)
	- scx:        scheduled transactions
	- workingSet: the working set of transactions (Yjs state, base64)
	- device:     this device's portable settings (secret fields blanked) and its device ID
	- peers:      trusted devices and the tombstones of evicted ones
	- secrets:    optional; the blanked secret fields, encrypted with a passphrase

	The device's own signing key is never in the file: it is not extractable by design, so a
	restored device is a new device (see restoredDevice.ts).
*/

import { ISODATEFORMAT, LONGTIMEFORMAT } from '#lib/constants';
import db from '#lib/data/db';
import { listScx, replaceAllScx } from '#lib/services/scxService';
import type { Revocation, ScheduledTransaction, TrustedPeer } from '#lib/data/model';
import { DeviceSettingKeys, deviceSettings, settings } from '#lib/settings';
import { getXactStore } from '#lib/storage/xactStoreRegistry';
import { getDeviceId } from '#lib/sync/ydocDevices';
import { formatDate } from '#lib/utils/dates';
import {
	isSecretsBlock,
	keepExistingSecrets,
	mergeSecrets,
	openSecrets,
	sealSecrets,
	secretId,
	SECRET_SPECS,
	specFor,
	splitSecrets,
	stillMissing,
	type SecretSpec,
	type SecretsBlock
} from './backupSecrets';
import { recordRestoredDevice } from './restoredDevice';
import { fromBase64, toBase64, WrongPassphraseError } from './s3Crypto';
import { setRestoreMissing } from './restoreMissing';

export const BACKUP_VERSION = 2;

export type BackupSection = 'settings' | 'scx' | 'workingSet' | 'device' | 'peers';

export const ALL_SECTIONS: BackupSection[] = ['settings', 'scx', 'workingSet', 'device', 'peers'];

interface StoredSetting {
	key: string;
	value: string;
}

interface DeviceSection {
	/** The ID of the device the backup was made on. */
	id: string;
	settings: StoredSetting[];
}

interface PeersSection {
	peers: TrustedPeer[];
	revocations: Revocation[];
}

interface Backup {
	version?: number;
	/** Secret fields that had a value and are blanked in the settings ('s3.accessKeyId'). */
	withheld?: string[];
	settings?: StoredSetting[];
	scx?: ScheduledTransaction[];
	/** base64 of the working set's Yjs state */
	workingSet?: string;
	device?: DeviceSection;
	peers?: PeersSection;
	secrets?: SecretsBlock;
}

/**
 * The device settings that travel in a backup. Everything else is tied to this device or to what it
 * has synced so far (its ID and key, sync progress, hashes of the files last seen) and is left out.
 * The sync group secret is left out too: an invite hands it out again.
 */
export const PORTABLE_DEVICE_KEYS: string[] = [
	DeviceSettingKeys.visibleCards,
	DeviceSettingKeys.peerName,
	DeviceSettingKeys.peerAutoReload,
	DeviceSettingKeys.peerIceServers,
	DeviceSettingKeys.importBookDirectory,
	DeviceSettingKeys.importAutoReload,
	DeviceSettingKeys.exportBookDirectory,
	DeviceSettingKeys.ledgerCacheEnabled,
	DeviceSettingKeys.notificationsEnabled,
	DeviceSettingKeys.notificationTime,
	DeviceSettingKeys.webdavAutoBackup,
	DeviceSettingKeys.webdavEncryption,
	DeviceSettingKeys.s3Settings,
	DeviceSettingKeys.s3AutoBackup,
	DeviceSettingKeys.syncWebdavEnabled,
	DeviceSettingKeys.syncS3Enabled,
	DeviceSettingKeys.syncPeerEnabled
];

const parseJson = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};

/**
 * Blanks the secret fields of the settings that have them. Returns the secrets that were taken
 * out, keyed by `secretId`, and the ids of the fields that had a value.
 */
function stripSecrets(
	list: StoredSetting[],
	store: SecretSpec['store'],
	into: { secrets: Record<string, unknown>; withheld: string[] }
): StoredSetting[] {
	return list.map((setting) => {
		const spec = specFor(store, setting.key);
		if (!spec) return setting;
		const value = parseJson(setting.value);
		if (value === undefined) return setting;
		const { plain, secrets, withheld } = splitSecrets(value, spec);
		if (secrets !== undefined) into.secrets[secretId(spec)] = secrets;
		into.withheld.push(...withheld);
		return { ...setting, value: JSON.stringify(plain) };
	});
}

export function getBackupFilename(): string {
	// filename
	const now = new Date();
	const date = formatDate(now, ISODATEFORMAT);
	const time = formatDate(now, LONGTIMEFORMAT);
	const filename = `cashier-backup_${date}_${time}.json`;

	return filename;
}

export interface BackupOptions {
	/** What goes into the file. All sections when left out. */
	sections?: BackupSection[];
	/** Set to include the credentials, encrypted with this passphrase. Without it, the file has none. */
	secretsPassphrase?: string;
}

/**
 * Generates backup file and sends it via download.
 */
export async function createBackupFile(filename: string, options?: BackupOptions) {
	const output: string = await createBackup(options);

	downloadTextFile(output, filename);
}

/**
 * Create backup content as text.
 * @returns Text containing the backup content.
 */
export async function createBackup(options: BackupOptions = {}) {
	const sections = new Set(options.sections ?? ALL_SECTIONS);
	const stripped = { secrets: {} as Record<string, unknown>, withheld: [] as string[] };
	const backup: Backup = { version: BACKUP_VERSION };

	if (sections.has('settings')) {
		const shared = stripSecrets(await settings.getAll(), 'settings', stripped);
		backup.settings = shared.sort((a, b) => a.key.localeCompare(b.key));
	}
	if (sections.has('scx')) backup.scx = await listScx();
	if (sections.has('workingSet')) {
		backup.workingSet = toBase64(await (await getXactStore()).exportState());
	}
	if (sections.has('device')) {
		const all = (await deviceSettings.getAll()) as StoredSetting[];
		const portable = all.filter((s) => PORTABLE_DEVICE_KEYS.includes(s.key));
		backup.device = {
			id: await getDeviceId(),
			settings: stripSecrets(portable, 'device', stripped).sort((a, b) =>
				a.key.localeCompare(b.key)
			)
		};
	}
	if (stripped.withheld.length > 0) backup.withheld = stripped.withheld;
	if (sections.has('peers')) {
		backup.peers = {
			peers: await db.peers.toArray(),
			revocations: await db.revocations.toArray()
		};
	}
	if (options.secretsPassphrase !== undefined) {
		// Checked even when there is nothing to seal, so a short passphrase is not silently accepted.
		backup.secrets = await sealSecrets(stripped.secrets, options.secretsPassphrase);
	}

	return JSON.stringify(backup);
}

function downloadTextFile(content: string, fileName: string) {
	const blob = new Blob([content], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);

	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	// Clean up
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 1500);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** Parses and checks the backup file, so nothing is deleted for a file that can't be restored. */
function parseBackup(content: string): Backup {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error('The backup file is not valid JSON');
	}
	if (!isObject(parsed)) throw new Error('Not a Cashier backup file');
	const backup = parsed as Backup;

	if (backup.version === undefined) {
		// Version 1: settings and scheduled transactions, both always present.
		if (!Array.isArray(backup.settings) || !Array.isArray(backup.scx)) {
			throw new Error('Not a Cashier backup file: settings and scheduled transactions are missing');
		}
		return backup;
	}
	if (typeof backup.version !== 'number' || backup.version < 2) {
		throw new Error('Not a Cashier backup file: unknown version');
	}
	if (backup.version > BACKUP_VERSION) {
		throw new Error(
			`This backup was made by a newer version of Cashier (backup format ${backup.version}). Update the app to restore it.`
		);
	}

	const bad = (what: string) => new Error(`Not a valid Cashier backup: ${what} is damaged`);
	if (backup.settings !== undefined && !Array.isArray(backup.settings)) throw bad('settings');
	if (backup.scx !== undefined && !Array.isArray(backup.scx)) throw bad('scheduled transactions');
	if (backup.workingSet !== undefined && typeof backup.workingSet !== 'string') {
		throw bad('the working set');
	}
	if (backup.device !== undefined) {
		const d = backup.device;
		if (!isObject(d) || typeof d.id !== 'string' || !Array.isArray(d.settings)) {
			throw bad('the device settings');
		}
	}
	if (backup.peers !== undefined) {
		const p = backup.peers;
		if (!isObject(p) || !Array.isArray(p.peers) || !Array.isArray(p.revocations)) {
			throw bad('the trusted devices');
		}
		if (p.peers.some((x) => !isObject(x) || typeof x.id !== 'string'))
			throw bad('the trusted devices');
	}
	if (backup.secrets !== undefined && !isSecretsBlock(backup.secrets)) throw bad('the credentials');
	if (!ALL_SECTIONS.some((s) => backup[s] !== undefined)) {
		throw new Error('The backup file holds nothing to restore');
	}
	return backup;
}

export interface BackupInfo {
	version: number;
	/** Sections the file holds. */
	sections: BackupSection[];
	hasSecrets: boolean;
	counts: { settings: number; scx: number; peers: number };
}

/** What a backup file holds, for the restore dialog. Throws for a file that can't be restored. */
export function inspectBackup(content: string): BackupInfo {
	const backup = parseBackup(content);
	return {
		version: backup.version ?? 1,
		sections: ALL_SECTIONS.filter((s) => backup[s] !== undefined),
		hasSecrets: backup.secrets !== undefined,
		counts: {
			settings: backup.settings?.length ?? 0,
			scx: backup.scx?.length ?? 0,
			peers: backup.peers?.peers.length ?? 0
		}
	};
}

export interface RestoreOptions {
	/** Sections to restore. Every section the file holds when left out. */
	sections?: BackupSection[];
	/** For the credentials block, when the file has one. */
	secretsPassphrase?: string;
}

export interface RestoreResult {
	restored: BackupSection[];
	/**
	 * What happened to the credentials: `none` the file has no block (or its settings were not
	 * restored), `restored`, `skipped` no passphrase was given, `wrong-passphrase` it did not fit.
	 * The rest of the backup is restored either way.
	 */
	secrets: 'none' | 'restored' | 'skipped' | 'wrong-passphrase';
	/** Fields left empty that the pages ask for ('s3.secretAccessKey'). */
	missing: string[];
	/** The ID of the device the backup was made on, when it is not this one. */
	predecessor?: string;
}

/**
 * Restores the backup. The settings and the scheduled transactions replace what is there; the
 * working set and the trusted devices are merged into it.
 * The file is validated before anything is written, so an invalid file keeps existing data.
 * @param content JSON contents of the backup file
 */
export async function restoreBackup(
	content: string,
	options: RestoreOptions = {}
): Promise<RestoreResult> {
	const backup = parseBackup(content);
	const wanted = new Set(options.sections ?? ALL_SECTIONS);
	const sections = ALL_SECTIONS.filter((s) => backup[s] !== undefined && wanted.has(s));

	// Decrypt before writing anything.
	let secrets: Record<string, unknown> = {};
	let secretsResult: RestoreResult['secrets'] = 'none';
	if (backup.secrets) {
		if (!options.secretsPassphrase) secretsResult = 'skipped';
		else {
			try {
				secrets = await openSecrets(backup.secrets, options.secretsPassphrase);
				secretsResult = 'restored';
			} catch (e) {
				if (!(e instanceof WrongPassphraseError)) throw e;
				secretsResult = 'wrong-passphrase';
			}
		}
	}

	if (sections.includes('settings')) await replaceSettings(backup.settings!, secrets);
	if (sections.includes('scx')) await replaceAllScx(backup.scx!);
	if (sections.includes('workingSet')) {
		await (await getXactStore()).importState(fromBase64(backup.workingSet!));
	}
	const result: RestoreResult = { restored: sections, secrets: secretsResult, missing: [] };
	if (sections.includes('device'))
		result.predecessor = await restoreDevice(backup.device!, secrets);
	if (sections.includes('peers')) await restorePeers(backup.peers!);

	// What the backup withheld and this device still has not got, for the pages to ask for.
	if (sections.includes('settings') || sections.includes('device')) {
		result.missing = await missingSecrets(backup.withheld ?? [], sections);
		await setRestoreMissing(result.missing);
	}
	return result;
}

async function missingSecrets(withheld: string[], restored: BackupSection[]): Promise<string[]> {
	const missing: string[] = [];
	for (const id of withheld) {
		const label = id.slice(0, id.indexOf('.'));
		const spec = SECRET_SPECS.find((s) => s.label === label);
		if (!spec || !restored.includes(spec.store === 'settings' ? 'settings' : 'device')) continue;
		const stored =
			spec.store === 'settings'
				? await settings.get<unknown>(spec.key)
				: await deviceSettings.get<unknown>(spec.key);
		if (stillMissing(id, stored)) missing.push(id);
	}
	return missing;
}

/** Applies the credentials in `secrets` to the settings of `store` in `list`. */
function withSecrets(
	list: StoredSetting[],
	store: SecretSpec['store'],
	secrets: Record<string, unknown>
): StoredSetting[] {
	return list.map((setting) => {
		const spec = specFor(store, setting.key);
		const block = spec ? secrets[secretId(spec)] : undefined;
		if (!spec || block === undefined) return setting;
		const value = parseJson(setting.value);
		if (value === undefined) return setting;
		return { ...setting, value: JSON.stringify(mergeSecrets(value, block)) };
	});
}

/** Keeps the secrets this device already has for the same server (see `keepExistingSecrets`). */
function keepExisting(
	restored: StoredSetting[],
	store: SecretSpec['store'],
	existing: StoredSetting[]
): StoredSetting[] {
	return restored.map((setting) => {
		const spec = specFor(store, setting.key);
		const current = existing.find((e) => e.key === setting.key);
		if (!spec || !current) return setting;
		const value = parseJson(setting.value);
		const old = parseJson(current.value);
		if (value === undefined || old === undefined) return setting;
		return { ...setting, value: JSON.stringify(keepExistingSecrets(value, old, spec)) };
	});
}

async function replaceSettings(restored: StoredSetting[], secrets: Record<string, unknown> = {}) {
	await db.transaction('rw', db.settings, async () => {
		const merged = keepExisting(
			withSecrets(restored, 'settings', secrets),
			'settings',
			(await db.settings.toArray()) as StoredSetting[]
		);
		await db.settings.clear();
		await db.settings.bulkAdd(merged);
	});
}

/**
 * Writes the portable device settings; the others (the ID, sync progress, ...) are left as they are.
 * Returns the old device's ID when the backup was made on another device than this one.
 */
async function restoreDevice(
	section: DeviceSection,
	secrets: Record<string, unknown>
): Promise<string | undefined> {
	const incoming = withSecrets(
		section.settings.filter((s) => PORTABLE_DEVICE_KEYS.includes(s.key)),
		'device',
		secrets
	);
	await db.transaction('rw', db.deviceSettings, async () => {
		const merged = keepExisting(
			incoming,
			'device',
			(await db.deviceSettings.toArray()) as StoredSetting[]
		);
		await db.deviceSettings.bulkPut(merged);
	});

	const mine = await getDeviceId();
	if (!section.id || section.id === mine) return undefined;
	await recordRestoredDevice(section.id);
	const { resetDeltaSyncRegistry } = await import('#lib/sync/deltaSyncRegistry');
	resetDeltaSyncRegistry();
	return section.id;
}

/**
 * Adds the trusted devices of the backup that this device does not have yet. Existing records are
 * not overwritten, and no device that was evicted (here or in the backup) is brought back.
 */
async function restorePeers(section: PeersSection) {
	await db.transaction('rw', db.peers, db.revocations, async () => {
		const local = await db.revocations.toArray();
		const evicted = new Set(
			[...local, ...section.revocations].filter((r) => r.status === 'evicted').map((r) => r.id)
		);
		const known = new Set(local.map((r) => r.id));
		await db.revocations.bulkAdd(section.revocations.filter((r) => !known.has(r.id)));

		for (const peer of section.peers) {
			if (evicted.has(peer.id) || peer.legacyIds?.some((id) => evicted.has(id))) continue;
			if (await db.peers.get(peer.id)) continue;
			await db.peers.add(peer);
		}
	});
}

/** The shared settings as JSON, without credentials. Sorted, so equal settings give equal text. */
export async function exportSettingsJson(): Promise<string> {
	const stripped = stripSecrets(await settings.getAll(), 'settings', { secrets: {}, withheld: [] });
	return JSON.stringify(stripped.sort((a, b) => a.key.localeCompare(b.key)));
}

/** Replaces the shared settings with those from `exportSettingsJson`. Validated before any write. */
export async function importSettingsJson(content: string) {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error('The settings data is not valid JSON');
	}
	if (!Array.isArray(parsed)) throw new Error('The settings data is not a list of settings');
	await replaceSettings(parsed as StoredSetting[]);
}
