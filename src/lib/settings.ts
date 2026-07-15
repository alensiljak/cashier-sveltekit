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
	// Home cards
	visibleCards: 'homeCardNames',
	// Peer sync
	peerRoom: 'peerRoom',
	// Relay network used for peer discovery signaling — must match between
	// devices to find each other (see src/lib/sync/peerPresence.svelte.ts)
	peerRelayStrategy: 'peerRelayStrategy',
	// Account groups for the groups page
	accountGroups: 'accountGroups',
	// WebDAV backup configuration
	webdavSettings: 'webdav-settings',
	// Date display format (moment.js format string)
	dateFormat: 'dateFormat',
	// Short date display format — day and month only
	shortDateFormat: 'shortDateFormat',
	// import book file spec (same across all devices)
	importBookFileSpec: 'importBookFileSpec',
	// Expenses report filter
	expensesHiddenAccounts: 'expenses.hiddenAccounts',
	// Budget category definitions (monthly targets)
	budgetDefinition: 'budget.definition',
	// Expenses home card: 'calendar-month' or 'rolling-days'
	expensesCardPeriodType: 'expensesCard.periodType',
	// Expenses home card: window size when periodType is 'rolling-days'
	expensesCardRollingDays: 'expensesCard.rollingDays'
};

/** Settings specific to this device (not exported). */
export const DeviceSettingKeys = {
	// Peer sync identity for this device
	peerId: 'peerId',
	peerName: 'peerName',
	// import book from filesystem via File System API
	importBookDirectory: 'importBookDirectory',
	// export book to filesystem via File System API
	exportBookDirectory: 'exportBookDirectory',
	// Whether to use the binary ledger cache on load (default: true)
	ledgerCacheEnabled: 'ledgerCacheEnabled',
	// OPFS file metadata snapshot for staleness detection (path -> "size|lastModified")
	ledgerMetaSnapshot: 'ledger.metaSnapshot',
	// Auto-upload cashier.bean to WebDAV after each write
	webdavAutoBackup: 'webdav-auto-backup'
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
