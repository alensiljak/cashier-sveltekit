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

/** The whole value is a secret: it is only in the encrypted credentials group. */
export interface WholeSecretRule {
	/** What the file and the restore page know the credential by. */
	wholeSecret: string;
}

/** `plain`: backed up as it is. `excluded`: never in a backup. */
export type BackupRule = 'plain' | 'excluded' | WholeSecretRule | SecretFieldsRule;

type ValueOf<T> = T[keyof T];

/**
 * Shared settings. The whole table is backed up and synced, so none can be excluded. Besides
 * these keys it holds the importer configs (`importer.<id>`), which are plain: they must not
 * contain secrets (see importers/config.ts).
 */
export const SHARED_RULES: Record<ValueOf<typeof SettingKeys>, 'plain' | SecretFieldsRule> = {
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
 * Device settings. What is excluded is tied to this device or to what it has synced so far (its
 * ID, sync progress, hashes of the files last seen), is a cache, or would mislead on another
 * device (the name of a folder the app has no access to there).
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
	[DeviceSettingKeys.importBookDirectory]: 'excluded',
	[DeviceSettingKeys.importAutoReload]: 'plain',
	[DeviceSettingKeys.exportBookDirectory]: 'excluded',
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
	[DeviceSettingKeys.syncStaleDays]: 'plain',
	[DeviceSettingKeys.proxy]: {
		secretFields: ['key'],
		identity: ['url'],
		label: 'proxy',
		track: false
	},
	[DeviceSettingKeys.awareApiKey]: { wholeSecret: 'aware' },
	[DeviceSettingKeys.priceDownloadStatus]: 'excluded',
	[DeviceSettingKeys.speechEngine]: 'plain',
	[DeviceSettingKeys.speechLanguage]: 'plain',
	[DeviceSettingKeys.speechVoiceMode]: 'plain',
	[DeviceSettingKeys.mistralApiKey]: { wholeSecret: 'mistral' },
	[DeviceSettingKeys.mistralTranscriptionModel]: 'plain',
	[DeviceSettingKeys.scalableTokens]: { wholeSecret: 'scalable' },
	[DeviceSettingKeys.enableBankingCredentials]: { wholeSecret: 'enableBanking' },
	[DeviceSettingKeys.enableBankingSessions]: { wholeSecret: 'enableBankingSessions' },
	[DeviceSettingKeys.enableBankingPendingAuth]: 'excluded',
	[DeviceSettingKeys.enableBankingBalances]: 'excluded'
};
/**
 * The device settings that travel in a backup outside the credentials group, with their secret
 * fields blanked. It is what gets written, and also the limit of what a restore of This device
 * writes, whatever a file holds.
 */
export const PORTABLE_DEVICE_KEYS: string[] = Object.entries(DEVICE_RULES)
	.filter(([, rule]) => rule === 'plain' || (typeof rule === 'object' && 'secretFields' in rule))
	.map(([key]) => key);

/** The table a setting is stored in. */
export type SettingStore = 'settings' | 'device';

export interface SecretSpec extends SecretFieldsRule {
	store: SettingStore;
	key: string;
}

/** A setting the credentials group carries, as a whole. */
export interface CredentialSetting {
	store: SettingStore;
	key: string;
	label: string;
	/** The secret fields of the setting; absent when the whole value is the secret. */
	secretFields?: string[];
}

const specsOf = (store: SettingStore, rules: Record<string, BackupRule>): SecretSpec[] =>
	Object.entries(rules).flatMap(([key, rule]) =>
		typeof rule === 'object' && 'secretFields' in rule ? [{ store, key, ...rule }] : []
	);

/** The settings with secret fields. */
export const SECRET_SPECS: SecretSpec[] = [
	...specsOf('settings', SHARED_RULES),
	...specsOf('device', DEVICE_RULES)
];

/** Every setting that holds a secret. A restore writes no other setting from the credentials. */
export const CREDENTIAL_SETTINGS: CredentialSetting[] = [
	...SECRET_SPECS,
	...Object.entries(DEVICE_RULES).flatMap(([key, rule]): CredentialSetting[] =>
		typeof rule === 'object' && 'wholeSecret' in rule
			? [{ store: 'device', key, label: rule.wholeSecret }]
			: []
	)
];
