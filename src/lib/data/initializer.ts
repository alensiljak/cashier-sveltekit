/*
    Initializes the minumum set of data required for running the application.
    The basic ledger is `cashier.bean` file, which is created in OPFS. This provides
    a functioning application.
    If the user imports their Ledger and selects the root file, that file is then
    included in `cashier.bean` and the whole book is parsed.
*/
import { CASHIER_XACT_FILE } from '$lib/constants';
// import { SettingKeys, settings } from '$lib/settings';
import appService from '$lib/services/appService';
import * as OpfsLib from '$lib/utils/opfslib';

/**
 * Initialize the application.
 */
export async function ensureInitialized() {
	// check if the ledger file exists in OPFS
	const mainFileExists = await OpfsLib.fileExists(CASHIER_XACT_FILE);
	if (mainFileExists) return;

	// Create the transactions file.
	await appService.createDefaultCashierFile();
}
