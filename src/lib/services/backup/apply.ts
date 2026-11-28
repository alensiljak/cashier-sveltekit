/**
 * Restore logic for all format versions. It works on `BackupData` and does not know about files.
 * The safety rules here (what may be written, which local secrets are kept, which devices stay
 * evicted) apply to every version.
 */
import db from '#lib/data/db';
import { recordRestoredDevice } from '#lib/services/restoredDevice';
import { setRestoreMissing } from '#lib/services/restoreMissing';
import { WrongPassphraseError } from '#lib/services/s3Crypto';
import { replaceAllScx } from '#lib/services/scxService';
import { deviceSettings, settings } from '#lib/settings';
import { getXactStore } from '#lib/storage/xactStoreRegistry';
import { getDeviceId } from '#lib/sync/ydocDevices';
import {
	ALL_SECTIONS,
	PORTABLE_DEVICE_KEYS,
	type BackupData,
	type BackupSection,
	type DeviceData,
	type FieldSecrets,
	type PeersData,
	type StoredSetting,
	type WithheldField
} from './model';
import {
	keepExistingSecrets,
	mergeSecrets,
	parseJson,
	specFor,
	stillMissing,
	type SecretSpec
} from './secrets';

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
 * `data` comes from a reader, so the file is validated before anything is written here.
 */
export async function applyBackup(
	data: BackupData,
	options: RestoreOptions = {}
): Promise<RestoreResult> {
	const wanted = new Set(options.sections ?? ALL_SECTIONS);
	const sections = ALL_SECTIONS.filter((s) => data[s] !== undefined && wanted.has(s));

	// Decrypt before writing anything.
	let secrets: FieldSecrets[] = [];
	let secretsResult: RestoreResult['secrets'] = 'none';
	if (data.openSecrets) {
		if (!options.secretsPassphrase) secretsResult = 'skipped';
		else {
			try {
				secrets = await data.openSecrets(options.secretsPassphrase);
				secretsResult = 'restored';
			} catch (e) {
				if (!(e instanceof WrongPassphraseError)) throw e;
				secretsResult = 'wrong-passphrase';
			}
		}
	}

	if (sections.includes('settings')) await replaceSettings(data.settings!, secrets);
	if (sections.includes('scx')) await replaceAllScx(data.scx!);
	if (sections.includes('workingSet')) {
		await (await getXactStore()).importState(data.workingSet!);
	}
	const result: RestoreResult = { restored: sections, secrets: secretsResult, missing: [] };
	if (sections.includes('device')) result.predecessor = await restoreDevice(data.device!, secrets);
	if (sections.includes('peers')) await restorePeers(data.peers!);

	// What the backup withheld and this device still has not got, for the pages to ask for.
	if (sections.includes('settings') || sections.includes('device')) {
		result.missing = await missingSecrets(data.withheld, sections);
		await setRestoreMissing(result.missing);
	}
	return result;
}

async function missingSecrets(
	withheld: WithheldField[],
	restored: BackupSection[]
): Promise<string[]> {
	const missing: string[] = [];
	for (const { id, store, key } of withheld) {
		if (!restored.includes(store === 'settings' ? 'settings' : 'device')) continue;
		const stored =
			store === 'settings'
				? await settings.get<unknown>(key)
				: await deviceSettings.get<unknown>(key);
		if (stillMissing(id, stored)) missing.push(id);
	}
	return missing;
}

/** Applies the credentials in `secrets` to the settings of `store` in `list`. */
function withSecrets(
	list: StoredSetting[],
	store: SecretSpec['store'],
	secrets: FieldSecrets[]
): StoredSetting[] {
	return list.map((setting) => {
		const found = secrets.find((s) => s.store === store && s.key === setting.key);
		if (!found) return setting;
		const value = parseJson(setting.value);
		if (value === undefined) return setting;
		return { ...setting, value: JSON.stringify(mergeSecrets(value, found.secrets)) };
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

async function replaceSettings(restored: StoredSetting[], secrets: FieldSecrets[] = []) {
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
	device: DeviceData,
	secrets: FieldSecrets[]
): Promise<string | undefined> {
	const incoming = withSecrets(
		device.settings.filter((s) => PORTABLE_DEVICE_KEYS.includes(s.key)),
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
	if (!device.id || device.id === mine) return undefined;
	await recordRestoredDevice(device.id);
	const { resetDeltaSyncRegistry } = await import('#lib/sync/deltaSyncRegistry');
	resetDeltaSyncRegistry();
	return device.id;
}

/**
 * Adds the trusted devices of the backup that this device does not have yet. Existing records are
 * not overwritten, and no device that was evicted (here or in the backup) is brought back.
 */
async function restorePeers(section: PeersData) {
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
