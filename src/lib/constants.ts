/**
 * Constants used across the application.
 */

export const DEFAULT_FORECAST_DAYS = 7 as const;

/** The default Cashier filename. Hard-coded for now. */
export const CASHIER_XACT_FILE = 'cashier.bean' as const;
/** OPFS folder for Cashier's internal bookkeeping (cache, hashes) — always excluded from exports. */
export const CASHIER_DATA_DIR = '.cashier' as const;
/** OPFS filename for the serialized ledger binary cache. */
export const LEDGER_CACHE_FILE = `${CASHIER_DATA_DIR}/ledger-cache.bin`;
/** OPFS filename for the source hash recorded at last serialization. */
export const LEDGER_CACHE_HASH_FILE = `${CASHIER_DATA_DIR}/ledger-cache.hash`;
export const ISODATEFORMAT = 'YYYY-MM-DD';
export const LONGTIMEFORMAT = 'HHmmss';
export const SHORT_DATE_FORMAT_DEFAULT = 'DD.MM.';
export const NUMBER_FORMAT = '#,##0.00';

/** Default OPFS filename for asset allocation definition. */
export const AA_DEFINITION_FILE = 'asset-allocation.toml';

// settings key
export const USER_BOOK_FILENAME = 'userBookFilename';
