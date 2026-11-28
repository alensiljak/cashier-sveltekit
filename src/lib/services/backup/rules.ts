/**
 * What a backup does with each setting. Every declared key has a rule, and the type check fails
 * when one is missing. The lists that backup and sync work with are generated from these rules.
 *
 * A rule says what is written now. The readers (readers/) have their own key lists, for what each
 * file format holds: a key that starts to be backed up has to be added to the latest one too.
 */
import { DeviceSettingKeys, SettingKeys } from '#lib/settings';

/**
 * The setting is backed up, but some fields of its value are secrets (the WebDAV password, the S3
 * secret key). The rest of it (URL, bucket, user) is plain.
 */
export interface SecretFieldsRule {
	/** Secret fields of the stored object; of each element, when the stored value is an array. */
	secretFields: string[];
	/**
	 * Plain fields that say what the secrets belong to. A secret already on this device is kept
	 * through a restore only when these are the same, so it is never paired with another server.
	 */
	identity: string[];
	/** Prefix of the field ids in `restoreMissing`, e.g. 'webdav' for 'webdav.password'. */
	label: string;
	/** Whether the pages mark an empty field of this setting as required after a restore. */
	track: boolean;
}

/** `plain`: backed up as it is. `excluded`: never in a backup. */
export type BackupRule = 'plain' | 'excluded' | SecretFieldsRule;

type ValueOf<T> = T[keyof T];

/**
 * Shared settings. The whole table is backed up and synced, so none can be excluded. Besides
 * these keys it holds the importer configs (`importer.<id>`), which are plain: they must not
 * contain secrets (see importers/config.ts).
 */
export const SHARED_RULES: Record<ValueOf<typeof SettingKeys>, Exclude<BackupRule, 'excluded'>> = {
	[SettingKeys.assetAllocationDefinition]: 'plain',
	[SettingKeys.rootInvestmentAccount]: 'plain',
	[SettingKeys.currency]: 'plain',
	[SettingKeys.favouriteAccounts]: 'plain',
	[SettingKeys.forecastAccounts]: 'plain',
	[SettingKeys.forecastDays]: 'plain',
	[SettingKeys.syncAccounts]: 'plain',
	[SettingKeys.syncAaValues]: 'plain',
	[SettingKeys.syncPayees]: 'plain',
	[SettingKeys.syncOpeningBalances]: 'plain',
	[SettingKeys.netWorthPeriod]: 'plain',
	[SettingKeys.peerRelayStrategy]: 'plain',
	[SettingKeys.accountGroups]: 'plain',
	[SettingKeys.webdavSettings]: {
		secretFields: ['password'],
		identity: ['url', 'username'],
		label: 'webdav',
		track: true
	},
	[SettingKeys.dateFormat]: 'plain',
	[SettingKeys.shortDateFormat]: 'plain',
	[SettingKeys.importBookFileSpec]: 'plain',
	[SettingKeys.userBookFilename]: 'plain',
	[SettingKeys.expensesHiddenAccounts]: 'plain',
	[SettingKeys.expenseTrendHiddenAccounts]: 'plain',
	[SettingKeys.budgetDefinition]: 'plain',
	[SettingKeys.taxReportConfig]: 'plain',
	[SettingKeys.expensesCardPeriodType]: 'plain',
	[SettingKeys.expensesCardRollingDays]: 'plain',
	[SettingKeys.priceProvider]: 'plain',
	[SettingKeys.priceTargetFile]: 'plain',
	[SettingKeys.priceWriteMode]: 'plain',
	[SettingKeys.priceSymbols]: 'plain',
	[SettingKeys.priceCatalogueSelection]: 'plain',
	[SettingKeys.priceNicknames]: 'plain',
	[SettingKeys.priceIgnored]: 'plain',
	[SettingKeys.priceDisabledProviders]: 'plain',
	[SettingKeys.priceSkippedProviders]: 'plain'
};

/**
 * Device settings. What is excluded is mostly tied to this device or to what it has synced so far
 * (its ID, sync progress, hashes of the files last seen), or is a cache. Some credentials are
 * excluded too: they stay on this device.
 */
export const DEVICE_RULES: Record<ValueOf<typeof DeviceSettingKeys>, BackupRule> = {
	[DeviceSettingKeys.priceCatalogues]: 'excluded',
	[DeviceSettingKeys.visibleCards]: 'plain',
	[DeviceSettingKeys.peerId]: 'excluded',
	[DeviceSettingKeys.peerName]: 'plain',
	[DeviceSettingKeys.previousDeviceId]: 'excluded',
	[DeviceSettingKeys.previousDeviceHeld]: 'excluded',
	[DeviceSettingKeys.restoreMissing]: 'excluded',
	// An invite hands it out again.
	[DeviceSettingKeys.syncGroupSecret]: 'excluded',
	[DeviceSettingKeys.syncGroupMembersMarked]: 'excluded',
	[DeviceSettingKeys.peerAutoReload]: 'plain',
	[DeviceSettingKeys.peerIceServers]: {
		secretFields: ['username', 'credential'],
		identity: ['urls'],
		label: 'ice',
		track: false
	},
	[DeviceSettingKeys.importBookDirectory]: 'plain',
	[DeviceSettingKeys.importAutoReload]: 'plain',
	[DeviceSettingKeys.exportBookDirectory]: 'plain',
	[DeviceSettingKeys.ledgerCacheEnabled]: 'plain',
	[DeviceSettingKeys.demoXactIds]: 'excluded',
	[DeviceSettingKeys.demoScxIds]: 'excluded',
	[DeviceSettingKeys.ledgerMetaSnapshot]: 'excluded',
	[DeviceSettingKeys.notificationsEnabled]: 'plain',
	[DeviceSettingKeys.notificationTime]: 'plain',
	[DeviceSettingKeys.notificationLastShown]: 'excluded',
	[DeviceSettingKeys.webdavAutoBackup]: 'plain',
	[DeviceSettingKeys.webdavLastSyncTs]: 'excluded',
	[DeviceSettingKeys.webdavEncryption]: {
		secretFields: ['passphrase'],
		identity: [],
		label: 'webdavEncryption',
		track: true
	},
	[DeviceSettingKeys.s3Settings]: {
		secretFields: ['accessKeyId', 'secretAccessKey', 'passphrase'],
		identity: ['endpoint', 'bucket', 'prefix'],
		label: 's3',
		track: true
	},
	[DeviceSettingKeys.s3SyncBase]: 'excluded',
	[DeviceSettingKeys.s3SyncEquiv]: 'excluded',
	[DeviceSettingKeys.deltaSyncState]: 'excluded',
	[DeviceSettingKeys.deltaSyncEpoch]: 'excluded',
	[DeviceSettingKeys.s3LastSync]: 'excluded',
	[DeviceSettingKeys.s3AutoBackup]: 'plain',
	[DeviceSettingKeys.syncWebdavEnabled]: 'plain',
	[DeviceSettingKeys.syncS3Enabled]: 'plain',
	[DeviceSettingKeys.syncPeerEnabled]: 'plain',
	[DeviceSettingKeys.syncChannelLastSync]: 'excluded',
	[DeviceSettingKeys.syncStaleDays]: 'excluded',
	[DeviceSettingKeys.proxyUrl]: 'excluded',
	[DeviceSettingKeys.proxyKey]: 'excluded',
	[DeviceSettingKeys.awareApiKey]: 'excluded',
	[DeviceSettingKeys.priceDownloadStatus]: 'excluded',
	[DeviceSettingKeys.speechEngine]: 'excluded',
	[DeviceSettingKeys.speechLanguage]: 'excluded',
	[DeviceSettingKeys.speechVoiceMode]: 'excluded',
	[DeviceSettingKeys.mistralApiKey]: 'excluded',
	[DeviceSettingKeys.mistralTranscriptionModel]: 'excluded',
	[DeviceSettingKeys.scalableTokens]: 'excluded',
	[DeviceSettingKeys.enableBankingCredentials]: 'excluded',
	[DeviceSettingKeys.enableBankingSessions]: 'excluded',
	[DeviceSettingKeys.enableBankingPendingAuth]: 'excluded',
	[DeviceSettingKeys.enableBankingBalances]: 'excluded'
};

/**
 * The device settings that travel in a backup. It is what gets written, and also the limit of what
 * a restore writes, whatever a file holds.
 */
export const PORTABLE_DEVICE_KEYS: string[] = Object.entries(DEVICE_RULES)
	.filter(([, rule]) => rule !== 'excluded')
	.map(([key]) => key);

export interface SecretSpec extends SecretFieldsRule {
	/** The table the setting is stored in. */
	store: 'settings' | 'device';
	key: string;
}

const specsOf = (store: SecretSpec['store'], rules: Record<string, BackupRule>): SecretSpec[] =>
	Object.entries(rules).flatMap(([key, rule]) =>
		typeof rule === 'object' ? [{ store, key, ...rule }] : []
	);

/** The settings with secret fields. */
export const SECRET_SPECS: SecretSpec[] = [
	...specsOf('settings', SHARED_RULES),
	...specsOf('device', DEVICE_RULES)
];
