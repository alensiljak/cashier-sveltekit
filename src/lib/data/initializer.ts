/*
    Initializes the minumum set of data required for running the application.
    The basic ledger is `cashier.bean` file, which is created in OPFS. This provides
    a functioning application.
    If the user imports their Ledger and selects the root file, that file is then
    included in `cashier.bean` and the whole book is parsed.

    On a genuine clean slate (no cashier.bean, no other .bean files, no book
    linked yet) `ensureInitialized()` does NOT create the empty file itself —
    it reports `needsOnboarding: true` so the root layout can route to
    `/onboarding` first, where the user's choice (demo data / import / empty)
    decides how `cashier.bean` gets created.
*/
import {
	CASHIER_XACT_FILE,
	DEMO_DIR,
	SHORT_DATE_FORMAT_DEFAULT,
	USER_BOOK_FILENAME
} from '$lib/constants';
import { SettingKeys, settings } from '$lib/settings';
import appService from '$lib/services/appService';
import fullLedgerService from '$lib/services/ledgerWorkerClient';
import { ShortDateFormatStore } from '$lib/data/mainStore';
import * as OpfsLib from '$lib/utils/opfslib';

/**
 * Initialize the application. Returns whether onboarding should run instead
 * of proceeding straight into the app.
 */
export async function ensureInitialized(): Promise<{ needsOnboarding: boolean }> {
	// check if the ledger file exists in OPFS
	const mainFileExists = await OpfsLib.fileExists(CASHIER_XACT_FILE);
	if (mainFileExists) return { needsOnboarding: false };

	if (await isCleanSlate()) {
		return { needsOnboarding: true };
	}

	// Create the transactions file.
	await appService.createDefaultCashierFile();
	return { needsOnboarding: false };
}

/** No transactions file, no other book linked or present anywhere in OPFS. */
async function isCleanSlate(): Promise<boolean> {
	const userBookFilename = await settings.get<string>(USER_BOOK_FILENAME);
	if (userBookFilename) return false;

	const tree = await OpfsLib.listFileTree();
	const hasOtherBeanFiles = tree.some(
		(entry) =>
			entry.kind === 'file' &&
			entry.name.endsWith('.bean') &&
			!entry.path.startsWith(`${DEMO_DIR}/`)
	);
	return !hasOtherBeanFiles;
}

/**
 * Loads device-local display settings and the full ledger. Call once
 * `cashier.bean` is known to exist (i.e. after `ensureInitialized()`, or
 * after the onboarding flow has created it).
 */
export async function finishInitialization(): Promise<void> {
	const savedShortDateFormat = await settings.get<string>(SettingKeys.shortDateFormat);
	ShortDateFormatStore.set(savedShortDateFormat ?? SHORT_DATE_FORMAT_DEFAULT);

	await fullLedgerService.ensureLoaded();
}
