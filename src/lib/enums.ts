export const BackupType = {
	JOURNAL: 'journal',
	SCHEDULEDXACTS: 'scheduled'
};

export const HomeCardNames = {
	FAVOURITES: 'FavouritesCard',
	FORECAST: 'ForecastCard',
	JOURNAL: 'JournalCard',
	SCHEDULED: 'ScheduledXactCard'
	// SYNC: 'SyncCard'
} as const;

export enum LedgerDataSource {
	filesystem = 'filesystem',
	beancount = 'beancount',
	rledger = 'rledger',
	ledger = 'ledger'
}

export enum LedgerFilenames {
	asset_allocation = 'asset-allocation.toml',
	accounts = 'accounts.bean',
	book = 'book.bean',
	cashier = 'cashier.bean',
	openingBalances = 'opening-balances.bean'
}

export const RecurrencePeriods = {
	Days: 'days',
	Weeks: 'weeks',
	Months: 'months',
	StartOfMonth: 'start of month',
	EndOfMonth: 'end of month',
	Years: 'years'
};

export enum PtaSystems {
	beancount = 'beancount',
	rledger = 'rledger',
	ledger = 'ledger'
}

export const SelectionType = {
	ACCOUNT: 'Account'
} as const;
