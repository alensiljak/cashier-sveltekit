/**
 * Constants used across the application.
 */

export const DEFAULT_FORECAST_DAYS = 7 as const;

/** The default Cashier filename. Hard-coded for now. */
export const CASHIER_XACT_FILE = 'cashier.bean' as const;
/** OPFS filename for the serialized ledger binary cache. */
export const LEDGER_CACHE_FILE = 'ledger-cache.bin';
export const ISODATEFORMAT = 'YYYY-MM-DD';
export const LONGTIMEFORMAT = 'HHmmss';
export const NUMBER_FORMAT = '#,##0.00';

// settings key
export const USER_BOOK_FILENAME = 'userBookFilename';
