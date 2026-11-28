/**
 * Format 3, not released yet: it may change until it is. The file is gzipped JSON (../index.ts
 * decompresses it). Every section is optional:
 *
 * - settings:    the shared settings (secret fields blanked)
 * - scx:         the scheduled transactions (Yjs state, base64)
 * - workingSet:  the working set of transactions (Yjs state, base64)
 * - device:      { id, settings }: portable device settings (secret fields blanked) and the device ID
 * - peers:       { peers, revocations }: trusted devices and the tombstones of evicted ones
 * - withheld:    the blanked secret fields that had a value ('s3.accessKeyId')
 * - credentials: which credentials `secrets` holds ('s3', 'mistral'), readable without a passphrase
 * - secrets:     those settings, whole and as stored, encrypted
 *
 * `device` and `peers` together are "This device".
 *
 * The keys below are what files of this format hold.
 */
import type { BackupData } from '../model';
import {
	readDevice,
	readList,
	readPeers,
	readSecrets,
	readSettings,
	readState,
	readWithheld,
	type SecretSetting
} from './common';

const DEVICE_KEYS = [
	'homeCardNames',
	'peerName',
	'peerAutoReload',
	'peerIceServers',
	'importAutoReload',
	'ledgerCacheEnabled',
	'notifications.enabled',
	'notifications.time',
	'webdav-auto-backup',
	'webdav-encryption',
	's3-settings',
	's3-auto-backup',
	'sync.webdav.enabled',
	'sync.s3.enabled',
	'sync.peer.enabled',
	'sync.stale-days',
	'proxy',
	'speech.engine',
	'speech.language',
	'speech.voice-mode',
	'speech.mistral.model'
];

const SECRET_SETTINGS: SecretSetting[] = [
	{ label: 'webdav', store: 'settings', key: 'webdav-settings' },
	{ label: 's3', store: 'device', key: 's3-settings' },
	{ label: 'webdavEncryption', store: 'device', key: 'webdav-encryption' },
	{ label: 'ice', store: 'device', key: 'peerIceServers' },
	{ label: 'proxy', store: 'device', key: 'proxy' },
	{ label: 'mistral', store: 'device', key: 'speech.mistral.api-key' },
	{ label: 'aware', store: 'device', key: 'prices.aware.api-key' },
	{ label: 'scalable', store: 'device', key: 'importer.scalable.tokens' },
	{ label: 'enableBanking', store: 'device', key: 'importer.enablebanking.credentials' },
	{ label: 'enableBankingSessions', store: 'device', key: 'importer.enablebanking.sessions' }
];

export function readV3(file: Record<string, unknown>): BackupData {
	const scx = readState(file.scx, 'the scheduled transactions');
	const listed = readList<unknown>(file.credentials, 'the list of credentials') ?? [];
	return {
		version: 3,
		settings: readSettings(file.settings),
		scx: scx && { state: scx },
		workingSet: readState(file.workingSet, 'the working set'),
		device: readDevice(file.device, DEVICE_KEYS),
		peers: readPeers(file.peers),
		withheld: readWithheld(file.withheld, SECRET_SETTINGS),
		credentials: SECRET_SETTINGS.map((s) => s.label).filter((label) => listed.includes(label)),
		openSecrets: readSecrets(file.secrets, SECRET_SETTINGS, ({ store, key }, value) => {
			if (typeof value !== 'string') {
				throw new Error('Not a valid Cashier backup: the credentials are damaged');
			}
			return { store, key, value };
		})
	};
}
