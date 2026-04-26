/**
 * Common Data Access Layer (DAL) code.
 */

import { LedgerDataSource } from '$lib/enums';
import { SettingKeys, settings } from '$lib/settings';
import CashierDAL from './dbdal';
import FSDAL from './fsdal';
import type { Account, Payee } from './model';

export interface DAL {
	loadAccounts(): Promise<Account[]>;
	loadPayees(): Promise<Payee[]>;
}

export async function createDAL(): Promise<DAL> {
	const dataSource = (await settings.get(SettingKeys.ledgerDataSource)) as string;
	if (!dataSource) {
		throw new Error('Ledger data source not configured');
	}

	switch (dataSource) {
		case LedgerDataSource.filesystem:
			return FSDAL.create();
		default:
			return CashierDAL.create();
	}
}
