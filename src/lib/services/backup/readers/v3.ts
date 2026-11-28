/**
 * Format 3, not released yet: it may change until it is. Every section is optional:
 *
 * - settings:   the shared settings (secret fields blanked)
 * - scx:        the scheduled transactions (Yjs state, base64)
 * - workingSet: the working set of transactions (Yjs state, base64)
 * - device:     { id, settings }: portable device settings (secret fields blanked) and the device ID
 * - peers:      { peers, revocations }: trusted devices and the tombstones of evicted ones
 * - withheld:   the blanked secret fields that had a value ('s3.accessKeyId')
 * - secrets:    the blanked secret fields, encrypted
 *
 * The keys below are what files of this format hold.
 */
import type { BackupData, StoredSetting } from '../model';
import {
	readDevice,
	readList,
	readPeers,
	readSecrets,
	readState,
	readWithheld,
	type SecretSetting
} from './common';

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

const SECRET_SETTINGS: SecretSetting[] = [
	{ label: 'webdav', store: 'settings', key: 'webdav-settings' },
	{ label: 's3', store: 'device', key: 's3-settings' },
	{ label: 'webdavEncryption', store: 'device', key: 'webdav-encryption' },
	{ label: 'ice', store: 'device', key: 'peerIceServers' }
];

export function readV3(file: Record<string, unknown>): BackupData {
	const scx = readState(file.scx, 'the scheduled transactions');
	return {
		version: 3,
		settings: readList<StoredSetting>(file.settings, 'settings'),
		scx: scx && { state: scx },
		workingSet: readState(file.workingSet, 'the working set'),
		device: readDevice(file.device, DEVICE_KEYS),
		peers: readPeers(file.peers),
		withheld: readWithheld(file.withheld, SECRET_SETTINGS),
		openSecrets: readSecrets(file.secrets, SECRET_SETTINGS)
	};
}
