/**
 * Format 2. Every section is optional:
 *
 * - settings:   the shared settings (secret fields blanked)
 * - scx:        scheduled transactions, as a list
 * - workingSet: the working set of transactions (Yjs state, base64)
 * - device:     { id, settings }: portable device settings (secret fields blanked) and the device ID
 * - peers:      { peers, revocations }: trusted devices and the tombstones of evicted ones
 * - withheld:   the blanked secret fields that had a value ('s3.accessKeyId')
 * - secrets:    the blanked secret fields, encrypted (see ../secrets.ts), by '<store>:<setting key>'
 *
 * The keys below are what files of this format hold. They are spelled out, so that renaming or
 * removing a setting in the app does not change how an old file is read.
 */
import type { ScheduledTransaction } from '#lib/data/model';
import { fromBase64 } from '#lib/services/s3Crypto';
import type {
	BackupData,
	DeviceData,
	FieldSecrets,
	PeersData,
	StoredSetting,
	WithheldField
} from '../model';
import { isSecretsBlock, openSecrets } from '../secrets';

const DEVICE_KEYS = [
	'homeCardNames',
	'peerName',
	'peerAutoReload',
	'peerIceServers',
	'importBookDirectory',
	'importAutoReload',
	'exportBookDirectory',
	'ledgerCacheEnabled',
	'notifications.enabled',
	'notifications.time',
	'webdav-auto-backup',
	'webdav-encryption',
	's3-settings',
	's3-auto-backup',
	'sync.webdav.enabled',
	'sync.s3.enabled',
	'sync.peer.enabled'
];

/** The settings with secrets, by their prefix in `withheld`. */
const SECRET_SETTINGS = [
	{ label: 'webdav', store: 'settings', key: 'webdav-settings' },
	{ label: 's3', store: 'device', key: 's3-settings' },
	{ label: 'webdavEncryption', store: 'device', key: 'webdav-encryption' },
	{ label: 'ice', store: 'device', key: 'peerIceServers' }
] as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

const damaged = (what: string) => new Error(`Not a valid Cashier backup: ${what} is damaged`);

function readList<T>(value: unknown, what: string): T[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw damaged(what);
	return value as T[];
}

function readWorkingSet(value: unknown): Uint8Array | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string') throw damaged('the working set');
	try {
		return fromBase64(value);
	} catch {
		throw damaged('the working set');
	}
}

function readDevice(value: unknown): DeviceData | undefined {
	if (value === undefined) return undefined;
	if (!isObject(value) || typeof value.id !== 'string' || !Array.isArray(value.settings)) {
		throw damaged('the device settings');
	}
	const settings = value.settings as StoredSetting[];
	return { id: value.id, settings: settings.filter((s) => DEVICE_KEYS.includes(s.key)) };
}

function readPeers(value: unknown): PeersData | undefined {
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

function readWithheld(value: unknown): WithheldField[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((id) => {
		if (typeof id !== 'string') return [];
		const label = id.slice(0, id.indexOf('.'));
		const setting = SECRET_SETTINGS.find((s) => s.label === label);
		return setting ? [{ id, store: setting.store, key: setting.key }] : [];
	});
}

function readSecrets(value: unknown): BackupData['openSecrets'] {
	if (value === undefined) return undefined;
	if (!isSecretsBlock(value)) throw damaged('the credentials');
	return async (passphrase) => {
		const block = await openSecrets(value, passphrase);
		return SECRET_SETTINGS.flatMap(({ store, key }): FieldSecrets[] => {
			const secrets = block[`${store}:${key}`];
			return secrets === undefined ? [] : [{ store, key, secrets }];
		});
	};
}

export function readV2(file: Record<string, unknown>): BackupData {
	return {
		version: 2,
		settings: readList<StoredSetting>(file.settings, 'settings'),
		scx: readList<ScheduledTransaction>(file.scx, 'scheduled transactions'),
		workingSet: readWorkingSet(file.workingSet),
		device: readDevice(file.device),
		peers: readPeers(file.peers),
		withheld: readWithheld(file.withheld),
		openSecrets: readSecrets(file.secrets)
	};
}
