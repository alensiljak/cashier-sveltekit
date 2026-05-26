import { SettingKeys, settings } from '$lib/settings.js';
import * as OpfsLib from '$lib/utils/opfslib.js';
import fullLedgerService from '$lib/services/ledgerWorkerClient.js';

export async function load() {
	const path = (await settings.get<string>(SettingKeys.assetAllocationDefinition)) ?? '';
	const definition = path ? ((await OpfsLib.readFile(path)) ?? '') : '';

	let commodities: string[] = [];
	try {
		if (fullLedgerService.isLoaded) {
			commodities = await fullLedgerService.getCurrencies();
		}
	} catch {
		// autocomplete will be empty if ledger unavailable
	}

	return { definition, path, commodities };
}
