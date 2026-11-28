/**
 * Checks and conversions of the parts that several formats store the same way. What a format
 * holds (its sections and keys) is said by its own reader, which passes the key lists in.
 * A change here must leave the released formats readable: their sample files are in the tests.
 */
import * as Y from 'yjs';
import type { ScheduledTransaction } from '#lib/data/model';
import { fromBase64 } from '#lib/services/s3Crypto';
import type {
	BackupData,
	Credential,
	DeviceData,
	PeersData,
	StoredSetting,
	WithheldField
} from '../model';
import type { SecretSpec } from '../rules';
import { isSecretsBlock, openSecrets } from '../secrets';

/** A setting with secrets, as a format names it: `label` is its prefix in `withheld`. */
export interface SecretSetting {
	label: string;
	store: SecretSpec['store'];
	key: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

const damaged = (what: string) => new Error(`Not a valid Cashier backup: ${what} is damaged`);

export function readList<T>(value: unknown, what: string): T[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw damaged(what);
	return value as T[];
}

/** Checks every entry of a list of settings and that no key is there twice. An empty list passes. */
export function checkSettingsList(value: unknown): StoredSetting[] {
	if (!Array.isArray(value)) throw new Error('The settings data is not a list of settings');
	const keys = new Set<string>();
	return value.map((entry: unknown) => {
		const { key, value } = (entry ?? {}) as Partial<StoredSetting>;
		if (typeof key !== 'string' || key === '' || typeof value !== 'string') {
			throw new Error('The settings data has an invalid entry');
		}
		if (keys.has(key)) throw new Error(`The settings data has "${key}" more than once`);
		keys.add(key);
		return { key, value };
	});
}

export const readSettings = (value: unknown): StoredSetting[] | undefined =>
	value === undefined ? undefined : checkSettingsList(value);

/** Scheduled transactions as a list, as formats 1 and 2 hold them. */
export function readScxList(value: unknown): ScheduledTransaction[] | undefined {
	const list = readList<unknown>(value, 'scheduled transactions');
	if (list && !list.every(isObject)) throw damaged('scheduled transactions');
	return list as ScheduledTransaction[] | undefined;
}

/** A store's Yjs state, base64. Tried out here, so that a damaged one stops the restore early. */
export function readState(value: unknown, what: string): Uint8Array | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string') throw damaged(what);
	const doc = new Y.Doc();
	try {
		const state = fromBase64(value);
		Y.applyUpdate(doc, state);
		return state;
	} catch {
		throw damaged(what);
	} finally {
		doc.destroy();
	}
}

export function readDevice(value: unknown, keys: string[]): DeviceData | undefined {
	if (value === undefined) return undefined;
	if (!isObject(value) || typeof value.id !== 'string' || !Array.isArray(value.settings)) {
		throw damaged('the device settings');
	}
	const settings = value.settings as StoredSetting[];
	return { id: value.id, settings: settings.filter((s) => keys.includes(s.key)) };
}

export function readPeers(value: unknown): PeersData | undefined {
	if (value === undefined) return undefined;
	if (
		!isObject(value) ||
		!Array.isArray(value.peers) ||
		!Array.isArray(value.revocations) ||
		value.peers.some((x) => !isObject(x) || typeof x.id !== 'string')
	) {
		throw damaged('the trusted devices');
	}
	return value as unknown as PeersData;
}

export function readWithheld(value: unknown, secretSettings: SecretSetting[]): WithheldField[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((id) => {
		if (typeof id !== 'string') return [];
		const label = id.slice(0, id.indexOf('.'));
		const setting = secretSettings.find((s) => s.label === label);
		return setting ? [{ id, store: setting.store, key: setting.key }] : [];
	});
}

/**
 * The encrypted block (see ../secrets.ts), holding entries by '<store>:<setting key>'. `convert`
 * says what an entry is in the format; settings that are not listed are left out.
 */
export function readSecrets(
	value: unknown,
	secretSettings: SecretSetting[],
	convert: (setting: SecretSetting, entry: unknown) => Credential
): BackupData['openSecrets'] {
	if (value === undefined) return undefined;
	if (!isSecretsBlock(value)) throw damaged('the credentials');
	return async (passphrase) => {
		const block = await openSecrets(value, passphrase);
		return secretSettings.flatMap((setting): Credential[] => {
			const entry = block[`${setting.store}:${setting.key}`];
			return entry === undefined ? [] : [convert(setting, entry)];
		});
	};
}
