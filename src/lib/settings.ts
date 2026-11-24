/*
    Various configuration-related things
*/
import db from '#lib/data/db';
import { Setting } from '#lib/data/model';

/**
 * Contains all the values required for the selection mode to function.
 * When an object of this type exists in the state store, we are in selection mode.
 */
export class SelectionModeMetadata {
	// The selection requestor. Can be used to explicitly name the origin and
	// avoid confusion in unexpected navigation routes.
	origin = '';

	postingIndex?: number;

	// The type of item being selected. Useful on return to the original entity.
	selectionType?: string;

	// The id of the selected item.
	selectedId: unknown;

	// Initial value to populate the calculator with
	initialValue?: number;

	// Restrict the account picker (/accounts) to names starting with this
	// prefix, e.g. 'Expenses:' for the Budget category picker.
	accountFilterPrefix?: string;
}

export const Constants = {
	CacheName: 'cashier',
	ForecastDays: 7
};

export interface AccountGroup {
	title: string;
	accounts: string[];
	color?: string;
	collapsed?: boolean;
}

export const defaultAccountGroups: AccountGroup[] = [
	{ title: 'Cash Accounts', accounts: [] },
	{ title: 'Bank Accounts', accounts: [] },
	{ title: 'Savings Accounts', accounts: [] },
	{ title: 'Credit Cards', accounts: [] },
	{ title: 'Loans', accounts: [] }
];

/** A single budgeted category: an account (and its descendants) plus a monthly target amount, in the default currency. */
export interface BudgetCategory {
	account: string;
	amount: number;
	/** Opt-in: unspent budget carries forward within the same calendar year. */
	rollover?: boolean;
	/** Month ('YYYY-MM') rollover accumulation starts from; set when rollover is first turned on. */
	since?: string;
}

/** Settings shared across all devices (exported/importable). */
export const SettingKeys = {
	// asset allocation settings
	assetAllocationDefinition: 'aa.definition',
	rootInvestmentAccount: 'aa.rootAccount',
	//
	currency: 'currency',
	favouriteAccounts: 'favouriteAccounts',
	// forecast
	forecastAccounts: 'forecast.accounts',
	forecastDays: 'forecast.days',
	// synchronization choices
	syncAccounts: 'syncAccounts',
	syncAaValues: 'syncAaValues',
	// syncAssetAllocation: 'syncAssetAllocation',
	syncPayees: 'syncPayees',
	syncOpeningBalances: 'syncOpeningBalances',
	// Net worth card period
	netWorthPeriod: 'netWorth.period',
	// Peer sync
	// Relay network used for peer discovery signaling — must match between
	// devices to find each other (see src/lib/sync/peerPresence.svelte.ts)
	peerRelayStrategy: 'peerRelayStrategy',
	// Account groups for the groups page
	accountGroups: 'accountGroups',
	// WebDAV backup configuration
	webdavSettings: 'webdav-settings',
	// Date display format (format string, see formatDate in utils/dates)
	dateFormat: 'dateFormat',
	// Short date display format — day and month only
	shortDateFormat: 'shortDateFormat',
	// import book file spec (same across all devices)
	importBookFileSpec: 'importBookFileSpec',
	// Expenses report filter
	expensesHiddenAccounts: 'expenses.hiddenAccounts',
	// Expense Trend report filter (separate from the Expenses one)
	expenseTrendHiddenAccounts: 'expenseTrend.hiddenAccounts',
	// Budget category definitions (monthly targets)
	budgetDefinition: 'budget.definition',
	// Tax summary report definition (year start + account categories)
	taxReportConfig: 'taxReport.config',
	// Expenses home card: 'calendar-month' or 'rolling-days'
	expensesCardPeriodType: 'expensesCard.periodType',
	// Expenses home card: window size when periodType is 'rolling-days'
	expensesCardRollingDays: 'expensesCard.rollingDays',
	// Price download (see doc/projects/2026-11-15_price-download.md). Shared so
	// every device writes the same destination file the same way.
	// provider: registry id ('ecb-frankfurter'); default: first registered.
	// targetFile: OPFS path, default PRICES_DEFAULT_DESTINATION.
	// writeMode: 'overwrite' | 'append', default 'overwrite'.
	// symbols: Record<providerId, string[]> — the symbols the user chose to
	// download for that provider. A missing provider entry means "all
	// book-relevant candidates".
	priceProvider: 'prices.provider',
	priceTargetFile: 'prices.targetFile',
	priceWriteMode: 'prices.writeMode',
	priceSymbols: 'prices.symbols',
	// catalogueSelection: Record<providerId, CatalogueProduct[]> — the products the user
	// picked from a securities provider's catalogue. Self-contained (id, label, identifiers)
	// so a routine download never needs the catalogue itself.
	priceCatalogueSelection: 'prices.catalogueSelection',
	// Book-driven price download (doc/projects/2026-11-16_book-driven-price-download.md).
	// nicknames: Record<string, providerId> — maps the `source` part of a commodity's
	// Beancount `price` meta (`QUOTE:source/SYMBOL`) to a registered provider id.
	// ignored: string[] — commodities acknowledged as deliberately not priced.
	priceNicknames: 'prices.nicknames',
	priceIgnored: 'prices.ignored',
	// disabledProviders: string[] — provider ids switched off on a provider's settings page.
	// Disabled providers are skipped by the book-driven download. Default: none (all on).
	priceDisabledProviders: 'prices.disabledProviders',
	// skippedProviders: string[] — providers unticked on the Price Download page. They stay
	// enabled and mapped, but are left out of the next download. Default: none (all included).
	priceSkippedProviders: 'prices.skippedProviders'
};

/** Settings specific to this device (not exported). */
export const DeviceSettingKeys = {
	// Downloaded provider catalogues: Record<providerId, { fetchedAt: ISO, products: CatalogueProduct[] }>.
	// A cache for browsing the catalogue; refreshed only by an explicit button press.
	priceCatalogues: 'prices.catalogues',
	// Home screen cards: visible card names, in display order. Each device keeps its own layout.
	// (Previously a shared setting under the same key; read as a fallback in appService.getVisibleCards.)
	visibleCards: 'homeCardNames',
	// Peer sync identity for this device
	peerId: 'peerId',
	peerName: 'peerName',
	// The UUID this device had before its ID was derived from its key. Kept until the objects it
	// wrote under that ID are forgotten (see doc/projects/2026-11-11_device-identity.md, step 5).
	previousDeviceId: 'previousDeviceId',
	// Set when `previousDeviceId` is the device this one was restored from (see backupService.ts):
	// its sync files are not retired (merged and deleted) until a person says that device is lost.
	previousDeviceHeld: 'previousDeviceHeld',
	// Fields a restore left empty because they are secrets, e.g. 'webdav.password' (see
	// restoreMissing.ts). The pages mark them as required until they are filled in.
	restoreMissing: 'restoreMissing',
	// Secret shared by the devices paired with each other (base64, 32 bytes). The Peer Sync room and
	// its signaling password are derived from it (sync/syncGroup.ts). Device-only: it is a credential.
	syncGroupSecret: 'syncGroupSecret',
	// Whether to automatically reload the ledger after a peer sync pull/merge (default: true)
	peerAutoReload: 'peerAutoReload',
	// TURN/ICE servers (JSON array) for peer connections that can't go direct. Device-only: holds credentials
	peerIceServers: 'peerIceServers',
	// import book from filesystem via File System API
	importBookDirectory: 'importBookDirectory',
	// Whether to automatically reload the ledger after an OPFS import (default: true)
	importAutoReload: 'importAutoReload',
	// export book to filesystem via File System API
	exportBookDirectory: 'exportBookDirectory',
	// Whether to use the binary ledger cache on load (default: true)
	ledgerCacheEnabled: 'ledgerCacheEnabled',
	// IDs of the sample transactions seeded into the CRDT store by the demo data (removed with it)
	demoXactIds: 'demoXactIds',
	// IDs of the sample scheduled transactions seeded by the demo data (removed with it)
	demoScxIds: 'demoScxIds',
	// OPFS file metadata snapshot for staleness detection (path -> "size|lastModified")
	ledgerMetaSnapshot: 'ledger.metaSnapshot',
	// Scheduled-transaction reminder: enabled flag, time of day ('HH:mm') and the date it last fired
	notificationsEnabled: 'notifications.enabled',
	notificationTime: 'notifications.time',
	notificationLastShown: 'notifications.lastShown',
	// Auto-upload the working set (Yjs state) to WebDAV after each write
	webdavAutoBackup: 'webdav-auto-backup',
	// Per-file remote timestamps at last successful WebDAV upload or download
	// Shape: { settings: ISO | null, scheduled: ISO | null }
	webdavLastSyncTs: 'webdav-last-sync-ts',
	// Encryption of the sync files in the WebDAV folder. Device-only: holds the passphrase.
	// Shape: { enabled: boolean, passphrase: string }
	webdavEncryption: 'webdav-encryption',
	// S3 sync bucket connection. Device-only: holds credentials.
	// Shape: { endpoint, region, bucket, prefix, accessKeyId, secretAccessKey }
	s3Settings: 's3-settings',
	// Content hash of each shared S3 object (settings, Beancount files) at the last sync, as the
	// common ancestor for conflict detection. Shape: Record<path, hash>
	s3SyncBase: 's3-sync-base',
	// Hashes verified (by comparing the text) to be the same content as the base hash, e.g. a copy
	// that differs only in line endings. Counted as the base when classifying, so they are not
	// conflicts. Shape: Record<path, { base: hash, hashes: hash[] }>; void once the base changes.
	s3SyncEquiv: 's3-sync-equiv',
	// Delta sync progress per store and bucket, key prefix: `<this>:<kind>:<bucket id>`.
	// Shape: DeltaState (see sync/deltaSync.ts). Device-only: it says what this device has applied.
	deltaSyncState: 'delta-sync-state',
	// When this device last completed an S3 upload or download. Shape: ISO string
	s3LastSync: 's3-last-sync',
	// Auto-upload the working set (Yjs state) to the S3 bucket after each write. Shape: boolean
	s3AutoBackup: 's3-auto-backup',
	// Which backup/sync options are enabled on this device (shown in the menu). Shape: boolean.
	// When unset, an option counts as enabled if it was already configured (see syncOptions.svelte.ts)
	syncWebdavEnabled: 'sync.webdav.enabled',
	syncS3Enabled: 'sync.s3.enabled',
	syncPeerEnabled: 'sync.peer.enabled',
	// When each sync channel last completed a sync from the Sync hub or home card.
	// Shape: Record<channelId, ISO string>. S3 also has its own s3LastSync, which takes precedence.
	syncChannelLastSync: 'sync.channel.last-sync',
	// Days without a completed sync before the Sync page warns. Number; default 7.
	syncStaleDays: 'sync.stale-days',
	// Base URL of the CORS proxy (worker/proxy.ts), e.g.
	// 'https://your-worker.workers.dev/api/proxy'. Empty: the app's own
	// same-origin '/api/proxy'. Device-only, not exported or synced.
	proxyUrl: 'proxy.url',
	// Shared key for the CORS proxy (worker/proxy.ts). Device-only: it is a
	// credential and is not exported or synced.
	proxyKey: 'proxy.key',
	// Aware Super's site API key (sent as X-API-KEY via the proxy). Device-only
	// credential, never exported or synced.
	awareApiKey: 'prices.aware.api-key',
	// Price download bookkeeping for this device. Shape: PriceDownloadStatus
	// (see services/prices/priceDownloadService.ts): lastRun, fixingDate,
	// written/added/updated counts, fetched and skipped symbols, lastError.
	priceDownloadStatus: 'prices.download.status',
	// Speech Entry transcription engine: 'builtin' (the browser's Web Speech API,
	// the default) or 'mistral' (Mistral Voxtral, see services/speechService.ts).
	speechEngine: 'speech.engine',
	// BCP-47 language tag for transcription ('en-US', 'de-DE', …). Empty: the
	// engine's own default.
	speechLanguage: 'speech.language',
	// Whether Quick Entry shows the microphone button (Voice mode). Boolean; default off.
	speechVoiceMode: 'speech.voice-mode',
	// Mistral API key for Voxtral transcription. Device-only: it is a credential
	// and is never exported or synced.
	mistralApiKey: 'speech.mistral.api-key',
	// Voxtral model id used for transcription. Default: MISTRAL_TRANSCRIPTION_MODEL.
	mistralTranscriptionModel: 'speech.mistral.model'
};

class UserSettings {
	async get<T>(key: unknown): Promise<T | null> {
		const setting = await db.settings.get(key);

		if (!setting) return null;

		let value = null;
		try {
			value = JSON.parse(setting.value);
		} catch {
			value = setting.value;
		}

		return value;
	}

	async getAll() {
		return db.settings.toArray();
	}

	async set(key: string, value: unknown) {
		const jsonValue = JSON.stringify(value);
		const setting = new Setting(key, jsonValue);

		await db.settings.put(setting);
	}

	async delete(key: string) {
		await db.settings.delete(key);
	}
}

class DeviceSettings {
	async get<T>(key: unknown): Promise<T | null> {
		const setting = await db.deviceSettings.get(key);

		if (!setting) return null;

		let value = null;
		try {
			value = JSON.parse(setting.value);
		} catch {
			value = setting.value;
		}

		return value;
	}

	async getAll() {
		return db.deviceSettings.toArray();
	}

	async set(key: string, value: unknown) {
		const jsonValue = JSON.stringify(value);
		const setting = new Setting(key, jsonValue);

		await db.deviceSettings.put(setting);
	}
}

const settings = new UserSettings();
const deviceSettings = new DeviceSettings();

export { settings, deviceSettings };
