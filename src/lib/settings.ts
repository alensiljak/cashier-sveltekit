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

export interface AccountGroup {
	title: string;
	accounts: string[];
	color?: string;
}

export interface CreditCardSettings {
	rootAccount: string;
	paymentDay: number;
	paymentAccount: string;
}

export const DEFAULT_CREDIT_CARD_ROOT_ACCOUNT = 'Liabilities:CreditCards';

export const defaultAccountGroups: AccountGroup[] = [
	{ title: 'Cash Accounts', accounts: [] },
	{ title: 'Bank Accounts', accounts: [] },
	{ title: 'Savings Accounts', accounts: [] },
	{ title: 'Credit Cards', accounts: [] },
	{ title: 'Loans', accounts: [] }
];

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
	// Cashier Server Sync
	syncServerUrl: 'syncServerUrl',
	// External data source system
	// ledgerDataSource: 'ledgerDataSource', // beancount, rledger, ledger, filesystem
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
	peerName: 'peerName',
	peerRoom: 'peerRoom',
	// import book from filesystem via File System API
	importBookDirectory: 'importBookDirectory',
	importBookFileSpec: 'importBookFileSpec',
	// Whether to use the binary ledger cache on load (default: true)
	ledgerCacheEnabled: 'ledgerCacheEnabled',
	// Account groups for the groups page
	accountGroups: 'accountGroups',
	// WebDAV backup configuration
	webdavSettings: 'webdav-settings',
	// Date display format (moment.js format string)
	dateFormat: 'dateFormat',
	// Short date display format — day and month only
	shortDateFormat: 'shortDateFormat',
	// Credit card forecast settings
	creditCardSettings: 'creditCard.settings',
	// OPFS file metadata snapshot for staleness detection (path -> "size|lastModified")
	ledgerMetaSnapshot: 'ledger.metaSnapshot'
};

export const CardNames = {
	FavouritesCard: 'FavouritesCard',
	ForecastCard: 'ForecastCard',
	JournalCard: 'JournalCard',
	ScheduledXactCard: 'ScheduledXactCard'
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
