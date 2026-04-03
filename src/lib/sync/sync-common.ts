/**
 * Common synchronization logic shared by all sync sources.
 * Handles parsing, storage, and orchestration after raw data is fetched.
 */
import appService from '$lib/services/appService';
import CashierDAL from '$lib/data/dal';
import { AssetAllocationEngine } from '$lib/assetAllocation/AssetAllocation';
import { settings, SettingKeys } from '$lib/settings';
import * as LedgerParser from '$lib/utils/ledgerParser';
import * as BeancountParser from '$lib/utils/beancountParser';
import * as RledgerParser from '$lib/utils/rledgerParser';
import type { CurrentValuesDict } from '$lib/data/viewModels';
import { PtaSystems } from '$lib/constants';

export interface SyncOptions {
	syncAccounts?: boolean;
	syncAaValues?: boolean;
	syncAssetAllocation?: boolean;
	syncPayees?: boolean;
	syncOpeningBalances?: boolean;
}

/**
 * Delete existing accounts and import new ones from a balance sheet response.
 */
export async function syncAccounts(
	ptaSystem: string,
	response: Record<string, unknown>
): Promise<void> {
	if (!response || Object.keys(response).length === 0) {
		throw new Error('No accounts received');
	}

	await appService.deleteAccounts();
	await appService.importBalanceSheet(ptaSystem, response);
}

/**
 * Parse current values per PTA system and import into asset allocation.
 */
export async function syncCurrentValues(ptaSystem: string, result: any): Promise<void> {
	const rootAccount = (await settings.get(SettingKeys.rootInvestmentAccount)) as string;
	if (!rootAccount) {
		throw new Error('No root investment account set!');
	}

	let currentValues: CurrentValuesDict;
	if (ptaSystem === PtaSystems.beancount) {
		currentValues = BeancountParser.parseCurrentValues(result, rootAccount);
		// } else if (ptaSystem === PtaSystems.rledger) {
		// 	currentValues = RledgerParser.parseCurrentValues(result, rootAccount);
	} else if (ptaSystem === PtaSystems.ledger) {
		currentValues = LedgerParser.parseCurrentValues(result, rootAccount);
	} else {
		throw new Error('Unknown PTA system: ' + ptaSystem);
	}

	const aa = new AssetAllocationEngine();
	await aa.importCurrentValues(currentValues);
}

/**
 * Delete existing payees and import new ones.
 */
export async function syncPayees(payeeNames: string[]): Promise<void> {
	if (!payeeNames || payeeNames.length === 0) {
		throw new Error('No payees received');
	}

	const dal = new CashierDAL();
	await dal.deletePayees();
	await appService.importPayees(payeeNames);
}
