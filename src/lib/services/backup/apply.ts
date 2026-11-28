/**
 * Restore logic for all format versions. It works on `BackupData` and does not know about files.
 * The safety rules here (what may be written, which local secrets are kept, which devices stay
 * evicted) apply to every version.
 */
import db from '#lib/data/db';
import { hasEverSynced, recordRestoredDevice } from '#lib/services/restoredDevice';
import { getRestoreMissing, setRestoreMissing } from '#lib/services/restoreMissing';
import { WrongPassphraseError } from '#lib/services/s3Crypto';
import { getReadyScxStore } from '#lib/services/scxService';
import { DeviceSettingKeys, deviceSettings, settings } from '#lib/settings';
import { AdoptDeclinedError } from '#lib/storage/crdtDocStore';
import { getXactStore } from '#lib/storage/xactStoreRegistry';
import { getDeviceId } from '#lib/sync/ydocDevices';
import { hasNotificationPermission } from '#lib/utils/webNotification';
import {
	ALL_SECTIONS,
	sectionsOf,
	type BackupData,
	type BackupSection,
	type Credential,
	type PeersData,
	type ScxData,
	type StoredSetting,
	type WithheldField
} from './model';
import {
	CREDENTIAL_SETTINGS,
	PORTABLE_DEVICE_KEYS,
	SECRET_SPECS,
	type SettingStore
} from './rules';
import {
	keepExistingSecrets,
	mergeSecrets,
	parseJson,
	sameConnection,
	specFor,
	stillMissing
} from './secrets';

export interface RestoreOptions {
	/** Sections to restore. Every section the file holds when left out. */
	sections?: BackupSection[];
	/** For the credentials block, when the file has one. */
	secretsPassphrase?: string;
}

export interface RestoreResult {
	/** The sections that were restored; `credentials` only when the block was opened. */
	restored: BackupSection[];
	/**
	 * What happened to the credentials: `none` the file has no block (or they were not asked for),
	 * `restored`, `skipped` no passphrase was given, `wrong-passphrase` it did not fit. The rest of
	 * the backup is restored either way.
	 */
	secrets: 'none' | 'restored' | 'skipped' | 'wrong-passphrase';
	/**
	 * Credentials of a format 2 file that were left out: only their secret fields are in the file,
	 * and neither the restored settings nor this device's have the connection they belong to.
	 */
	unmatched?: string[];
	/** The backup has notifications on, but the browser has not given the permission here. */
	notificationsOff?: boolean;
	/** Fields left empty that the pages ask for ('s3.secretAccessKey'). */
	missing: string[];
	/** What the merge did to each transaction store that was restored. */
	stores: StoreOutcomes;
	/**
	 * The ID of the device the backup was made on, when it was recorded as the one this device
	 * replaces: it is another device, and this one had never synced.
	 */
	predecessor?: string;
}

/** What merging the backup into a transaction store does, in records. */
export interface StoreOutcome {
	added: number;
	changed: number;
	deleted: number;
	/** The backup was made before the store was reset, so nothing of it is taken. */
	ignored?: boolean;
	/** The user chose to wait before adopting a reset the backup holds: nothing was changed. */
	postponed?: boolean;
}

export type StoreSection = Extract<BackupSection, 'scx' | 'workingSet'>;

export type StoreOutcomes = Partial<Record<StoreSection, StoreOutcome>>;

const NOTHING: StoreOutcome = { added: 0, changed: 0, deleted: 0 };

function countChanges(changes: { action: 'add' | 'update' | 'delete' }[]): StoreOutcome {
	const count = (action: string) => changes.filter((c) => c.action === action).length;
	return { added: count('add'), changed: count('update'), deleted: count('delete') };
}

const getStore = (section: StoreSection) =>
	section === 'scx' ? getReadyScxStore() : getXactStore();

/** What restoring the transaction stores of `data` would do now. Nothing is written to them. */
export async function previewStores(data: BackupData): Promise<StoreOutcomes> {
	const result: StoreOutcomes = {};
	if (data.scx && 'list' in data.scx) {
		const missing = await (await getReadyScxStore()).missingFrom(data.scx.list);
		result.scx = { ...NOTHING, added: missing.length };
	}
	const states: [StoreSection, Uint8Array | undefined][] = [
		['scx', data.scx && 'state' in data.scx ? data.scx.state : undefined],
		['workingSet', data.workingSet]
	];
	for (const [section, state] of states) {
		if (!state) continue;
		const store = await getStore(section);
		if (await store.wouldIgnore(state)) result[section] = { ...NOTHING, ignored: true };
		else result[section] = countChanges((await store.previewImport([state]))[0]);
	}
	return result;
}

/** Merges a saved state into a store, and says what that did. */
async function mergeState(section: StoreSection, state: Uint8Array): Promise<StoreOutcome> {
	const store = await getStore(section);
	if (await store.wouldIgnore(state)) return { ...NOTHING, ignored: true };
	try {
		return countChanges(await store.importState(state));
	} catch (e) {
		if (!(e instanceof AdoptDeclinedError)) throw e;
		return { ...NOTHING, postponed: true };
	}
}

/**
 * Restores the backup. The shared settings replace what is there; the device settings and the
 * credentials overwrite what they hold; the transaction stores and the trusted devices are merged.
 * A list of scheduled transactions (older files) adds the entries that are missing. `data` comes
 * from a reader, so the file is validated before anything is written here.
 */
export async function applyBackup(
	data: BackupData,
	options: RestoreOptions = {}
): Promise<RestoreResult> {
	const wanted = new Set(options.sections ?? ALL_SECTIONS);
	let sections = sectionsOf(data).filter((s) => wanted.has(s));
	// An empty list would erase the settings of this device.
	if (sections.includes('settings') && data.settings!.length === 0) {
		throw new Error(
			'The settings list in the backup is empty. Leave the settings out to restore the rest.'
		);
	}
	const device = sections.includes('device') ? data.device : undefined;
	// Looked at before this restore writes anything.
	const synced = !!device && (await hasEverSynced());

	// Decrypt before writing anything.
	let credentials: Credential[] = [];
	let secretsResult: RestoreResult['secrets'] = 'none';
	if (sections.includes('credentials')) {
		if (!options.secretsPassphrase) secretsResult = 'skipped';
		else {
			try {
				credentials = await data.openSecrets!(options.secretsPassphrase);
				secretsResult = 'restored';
			} catch (e) {
				if (!(e instanceof WrongPassphraseError)) throw e;
				secretsResult = 'wrong-passphrase';
			}
		}
		if (secretsResult !== 'restored') sections = sections.filter((s) => s !== 'credentials');
	}
	const result: RestoreResult = {
		restored: sections,
		secrets: secretsResult,
		missing: [],
		stores: {}
	};
	const unmatched: string[] = [];

	unmatched.push(
		...(await writeSettings(
			'settings',
			sections.includes('settings') ? data.settings : undefined,
			credentials,
			data.settings
		))
	);
	if (sections.includes('scx')) result.stores.scx = await restoreScx(data.scx!);
	if (sections.includes('workingSet')) {
		result.stores.workingSet = await mergeState('workingSet', data.workingSet!);
	}
	let incoming = device?.settings.filter((s) => PORTABLE_DEVICE_KEYS.includes(s.key));
	if (incoming && !hasNotificationPermission()) {
		incoming = incoming.map((s) => {
			if (s.key !== DeviceSettingKeys.notificationsEnabled || parseJson(s.value) !== true) return s;
			result.notificationsOff = true;
			return { ...s, value: 'false' };
		});
	}
	unmatched.push(...(await writeSettings('device', incoming, credentials, data.device?.settings)));
	if (device) {
		const predecessor = await recordPredecessor(device.id, !synced);
		if (predecessor) result.predecessor = predecessor;
	}
	if (sections.includes('device') && data.peers) await restorePeers(data.peers);
	if (unmatched.length > 0) result.unmatched = unmatched;

	// What the backup withheld and this device still has not got, for the pages to ask for.
	if (sections.includes('settings') || device) {
		result.missing = await missingSecrets(data.withheld, sections);
		await setRestoreMissing(result.missing);
	} else if (sections.includes('credentials')) {
		await dropFilledFields();
	}
	return result;
}
async function restoreScx(scx: ScxData): Promise<StoreOutcome> {
	if (!('list' in scx)) return mergeState('scx', scx.state);
	const added = await (await getReadyScxStore()).addMissing(scx.list);
	return { ...NOTHING, added: added.length };
}

const storedValue = (store: SettingStore, key: string) =>
	store === 'settings' ? settings.get<unknown>(key) : deviceSettings.get<unknown>(key);

async function missingSecrets(
	withheld: WithheldField[],
	restored: BackupSection[]
): Promise<string[]> {
	const missing: string[] = [];
	for (const { id, store, key } of withheld) {
		if (!restored.includes(store === 'settings' ? 'settings' : 'device')) continue;
		if (stillMissing(id, await storedValue(store, key))) missing.push(id);
	}
	return missing;
}

/** Takes the fields that now have a value off the list of the ones to fill in. */
async function dropFilledFields(): Promise<void> {
	const missing: string[] = [];
	for (const id of await getRestoreMissing()) {
		const spec = SECRET_SPECS.find((s) => id.startsWith(`${s.label}.`));
		if (spec && stillMissing(id, await storedValue(spec.store, spec.key))) missing.push(id);
	}
	await setRestoreMissing(missing);
}

/** Puts the secret fields of format 2 back into the settings of `store` in `list`. */
function withFields(
	list: StoredSetting[],
	store: SettingStore,
	credentials: Credential[]
): StoredSetting[] {
	return list.map((setting) => {
		const found = credentials.find((c) => c.store === store && c.key === setting.key);
		if (!found || !('fields' in found)) return setting;
		const value = parseJson(setting.value);
		if (value === undefined) return setting;
		return { ...setting, value: JSON.stringify(mergeSecrets(value, found.fields)) };
	});
}

/** Keeps the secrets this device already has for the same server (see `keepExistingSecrets`). */
function keepExisting(
	restored: StoredSetting[],
	store: SettingStore,
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

/**
 * This device's setting with the secret fields of format 2 put in, for a setting that is not
 * being restored. Undefined unless it is for the same connection as the one in the file.
 */
function addToLocal(
	fields: unknown,
	local: StoredSetting | undefined,
	inFile: StoredSetting | undefined,
	store: SettingStore
): StoredSetting | undefined {
	if (!local || !inFile) return undefined;
	const spec = specFor(store, local.key);
	const value = parseJson(local.value);
	if (!spec || !sameConnection(parseJson(inFile.value), value, spec)) return undefined;
	return { key: local.key, value: JSON.stringify(mergeSecrets(value, fields)) };
}

/**
 * Writes one of the two settings tables, in one transaction:
 *
 * - `restored`, the plain settings of the file, when they are being restored. The shared settings
 *   replace the table; device settings overwrite their keys only. A secret this device already has
 *   for the same server is kept where the file has none.
 * - the credentials of this table. A whole one overwrites the setting, whatever else is restored.
 *   Secret fields (format 2) go into the restored setting, or into this device's when it is for
 *   the same connection as the one in the file (`inFile`).
 *
 * @returns The keys of the secret fields that could not be put anywhere.
 */
async function writeSettings(
	store: SettingStore,
	restored: StoredSetting[] | undefined,
	credentials: Credential[],
	inFile: StoredSetting[] = []
): Promise<string[]> {
	// Only what is a credential by the current rules, whatever the file holds.
	const mine = credentials.filter(
		(c) =>
			c.store === store && CREDENTIAL_SETTINGS.some((s) => s.store === store && s.key === c.key)
	);
	if (!restored && mine.length === 0) return [];
	const table = store === 'settings' ? db.settings : db.deviceSettings;
	const unmatched: string[] = [];

	await db.transaction('rw', table, async () => {
		const existing = (await table.toArray()) as StoredSetting[];
		const next = new Map(
			keepExisting(withFields(restored ?? [], store, mine), store, existing).map((s) => [s.key, s])
		);
		for (const credential of mine) {
			const { key } = credential;
			if ('value' in credential) next.set(key, { key, value: credential.value });
			else if (!next.has(key)) {
				const merged = addToLocal(
					credential.fields,
					existing.find((s) => s.key === key),
					inFile.find((s) => s.key === key),
					store
				);
				if (merged) next.set(key, merged);
				else unmatched.push(key);
			}
		}
		if (restored && store === 'settings') {
			await table.clear();
			await table.bulkAdd([...next.values()]);
		} else {
			await table.bulkPut([...next.values()]);
		}
	});
	return unmatched;
}

/**
 * Replaces the shared settings with `restored`. A secret this device already has for the same
 * server is kept where `restored` has none.
 */
export async function replaceSettings(restored: StoredSetting[]) {
	await writeSettings('settings', restored, []);
}

/**
 * With `mayReplace`, a backup made on another device records that one as the device this one
 * replaces, and returns its ID.
 */
async function recordPredecessor(id: string, mayReplace: boolean): Promise<string | undefined> {
	const mine = await getDeviceId();
	if (!mayReplace || !id || id === mine) return undefined;
	await recordRestoredDevice(id);
	const { resetDeltaSyncRegistry } = await import('#lib/sync/deltaSyncRegistry');
	resetDeltaSyncRegistry();
	return id;
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
			// The file-sync baseline it speaks of is not restored: pairing has to create it again.
			const { fileSyncInitializedAt: _, ...added } = peer;
			await db.peers.add(added);
		}
	});
}
