/*
    Initializes the minumum set of data required for running the application.
*/
import { CASHIER_XACT_FILE } from '$lib/constants';
import { SettingKeys, settings } from '$lib/settings';
import * as OpfsLib from '$lib/utils/opfslib';

export async function initialize() {
    // Create the transactions file.
    await OpfsLib.saveFile(CASHIER_XACT_FILE, '');

    // Set the main file.
    await settings.set(SettingKeys.bookFilename, CASHIER_XACT_FILE);
}