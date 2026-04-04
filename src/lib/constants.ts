export const AssetAllocationFilename = 'asset-allocation.toml';
/**
 * Filename for transactions.
 */
export const CashierFilename = 'cashier.bean';

/**
 * List of all infrastructure files to synchronize.
 * Add new filenames to this array when new infrastructure files are introduced.
 */
export const InfrastructureFiles = [
	'book.bean',
	// 'commodities.bean',
	'accounts.bean',
	'opening-balances.bean',
	CashierFilename
] as const;

export enum PtaSystems {
	beancount = 'beancount',
	rledger = 'rledger',
	ledger = 'ledger'
}

export enum LedgerDataSource {
	filesystem = 'filesystem',
	beancount = 'beancount',
	rledger = 'rledger',
	ledger = 'ledger'
}

export const DEFAULT_FORECAST_DAYS = 7 as const;
export const ISODATEFORMAT = 'YYYY-MM-DD';
export const LONGTIMEFORMAT = 'HHmmss';
export const NUMBER_FORMAT = '#,##0.00';
