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

// Demo data — bundled sample book so first-time users (and agents testing in a
// browser) get a populated, working app instead of a blank one. Files live in a
// dedicated root-level folder (never `.cashier/`, which the ledger's `.bean`
// scanner skips entirely) so `include` resolution still finds them. Only
// `cashier.bean` is ever written to directly — everything under `DEMO_DIR` is
// read-only reference data managed by demoDataService.
export const DEMO_DIR = 'cashier-demo';
export const DEMO_BOOK_FILE = `${DEMO_DIR}/book.bean`;
export const DEMO_ACCOUNTS_FILE = `${DEMO_DIR}/accounts.bean`;
export const DEMO_COMMODITIES_FILE = `${DEMO_DIR}/commodities.bean`;
export const DEMO_PRICES_FILE = `${DEMO_DIR}/prices.bean`;
export const DEMO_AA_FILE = `${DEMO_DIR}/asset-allocation.toml`;
export const DEMO_ROOT_INVESTMENT_ACCOUNT = 'Assets:Investments:Brokerage';
