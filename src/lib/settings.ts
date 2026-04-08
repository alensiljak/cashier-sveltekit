/*
    Various configuration-related things
*/
import db from '$lib/data/db';
import { Setting } from '$lib/data/model';

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
}

export const Constants = {
	CacheName: 'cashier',
	ForecastDays: 7
};

export const SettingKeys = {
	// root files in OPFS
	bookFilename: 'bookFilename',
	assetAllocationDefinition: 'aa.definition',
	//
	backupServerUrl: 'backupServerUrl', // Server for online backup (pCloud).
	currency: 'currency',
	favouriteAccounts: 'favouriteAccounts',
	forecastAccounts: 'forecast.accounts',
	forecastDays: 'forecast.days',
	dbInitialized: 'dbInitialized', // Marks that the db has been initialized
	pCloudToken: 'pCloudToken',
	// Cashier Server Sync
	syncServerUrl: 'syncServerUrl',
	// External data source system
	ledgerDataSource: 'ledgerDataSource', // beancount, rledger, ledger, filesystem
	rootInvestmentAccount: 'aa.rootAccount',
	rememberLastTransaction: 'rememberLastTransaction',
	// synchronization choices
	syncAccounts: 'syncAccounts',
	syncAaValues: 'syncAaValues',
	// syncAssetAllocation: 'syncAssetAllocation',
	syncPayees: 'syncPayees',
	syncOpeningBalances: 'syncOpeningBalances',
	// Home cards
	visibleCards: 'homeCardNames',
	// Peer sync
	peerId: 'peerId',
	syncServers: 'syncServers',
	syncActiveServerId: 'syncActiveServerId',
	// book import from filesystem via File System API
	importBookDirectory: 'importBookDirectory',
	// Full path to the main book/journal file (set via fs-sync page)
	externalBook: 'externalBook',
	externalAssetAllocation: 'externalAssetAllocation',
	// SHA-256 hash of source files at last serialization, stored alongside the OPFS binary cache
	ledgerCacheHash: 'ledgerCacheHash'
};

export const CardNames = {
	FavouritesCard: 'FavouritesCard',
	ForecastCard: 'ForecastCard',
	JournalCard: 'JournalCard',
	ScheduledXactCard: 'ScheduledXactCard',
	// SyncCard: 'SyncCard'
};

class Settings {
	/**
	 *
	 * @param {any} key
	 * @returns Promise with the Setting object
	 */
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
}

const settings = new Settings();
export { settings };
