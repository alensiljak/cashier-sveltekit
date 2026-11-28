/**
 * Restore logic for all format versions. It works on `BackupData` and does not know about files.
 * The safety rules here (what may be written, which local secrets are kept, which devices stay
 * evicted) apply to every version.
 */
import db from '#lib/data/db';
import { hasEverSynced, recordRestoredDevice } from '#lib/services/restoredDevice';
import { setRestoreMissing } from '#lib/services/restoreMissing';
import { WrongPassphraseError } from '#lib/services/s3Crypto';
import { getReadyScxStore } from '#lib/services/scxService';
import { deviceSettings, settings } from '#lib/settings';
import { AdoptDeclinedError } from '#lib/storage/crdtDocStore';
import { getXactStore } from '#lib/storage/xactStoreRegistry';
import { getDeviceId } from '#lib/sync/ydocDevices';
import {
	ALL_SECTIONS,
	type BackupData,
	type BackupSection,
	type DeviceData,
	type FieldSecrets,
	type PeersData,
	type ScxData,
	type StoredSetting,
	type WithheldField
} from './model';
import { PORTABLE_DEVICE_KEYS, type SecretSpec } from './rules';
import { keepExistingSecrets, mergeSecrets, parseJson, specFor, stillMissing } from './secrets';

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
 * Restores the backup. The settings replace what is there; the transaction stores and the trusted
 * devices are merged into it. A list of scheduled transactions (older files) adds the entries that
 * are missing. `data` comes from a reader, so the file is validated before anything is written here.
 */
export async function applyBackup(
	data: BackupData,
	options: RestoreOptions = {}
): Promise<RestoreResult> {
	const wanted = new Set(options.sections ?? ALL_SECTIONS);
	const sections = ALL_SECTIONS.filter((s) => data[s] !== undefined && wanted.has(s));
	// An empty list would erase the settings of this device.
	if (sections.includes('settings') && data.settings!.length === 0) {
		throw new Error(
			'The settings list in the backup is empty. Leave the settings out to restore the rest.'
		);
	}
	// Looked at before this restore writes anything.
	const synced = sections.includes('device') && (await hasEverSynced());

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
	const stores: StoreOutcomes = {};
	if (sections.includes('scx')) stores.scx = await restoreScx(data.scx!);
	if (sections.includes('workingSet')) {
		stores.workingSet = await mergeState('workingSet', data.workingSet!);
	}
	const result: RestoreResult = {
		restored: sections,
		secrets: secretsResult,
		missing: [],
		stores
	};
	if (sections.includes('device')) {
		result.predecessor = await restoreDevice(data.device!, secrets, !synced);
	}
	if (sections.includes('peers')) await restorePeers(data.peers!);

	// What the backup withheld and this device still has not got, for the pages to ask for.
	if (sections.includes('settings') || sections.includes('device')) {
		result.missing = await missingSecrets(data.withheld, sections);
		await setRestoreMissing(result.missing);
	}
	return result;
}

async function restoreScx(scx: ScxData): Promise<StoreOutcome> {
	if (!('list' in scx)) return mergeState('scx', scx.state);
	const added = await (await getReadyScxStore()).addMissing(scx.list);
	return { ...NOTHING, added: added.length };
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

/**
 * Replaces the shared settings with `restored`, in one transaction. A secret this device already
 * has for the same server is kept where `restored` has none.
 */
export async function replaceSettings(restored: StoredSetting[], secrets: FieldSecrets[] = []) {
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
 * With `mayReplace`, a backup made on another device records that one as the device this one
 * replaces, and returns its ID.
 */
async function restoreDevice(
	device: DeviceData,
	secrets: FieldSecrets[],
	mayReplace: boolean
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
	if (!mayReplace || !device.id || device.id === mine) return undefined;
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
			// The file-sync baseline it speaks of is not restored: pairing has to create it again.
			const { fileSyncInitializedAt: _, ...added } = peer;
			await db.peers.add(added);
		}
	});
}
