/**
 * File-System-based Data Access Layer (FSDAL).
 * All data is loaded from the filesystem and provided by BQL queries from Rust Ledger WASM.
 */

import localLedgerService from "$lib/services/localLedgerService";
import Notifier from "$lib/utils/notifier";
import type { DAL } from "./dal";
import db from "./db";
import { Account, Payee } from "./model";

export default class FSDAL implements DAL {
    private constructor() {}

    static async create(): Promise<FSDAL> {
        const dal = new FSDAL();
        await localLedgerService.ensureLoaded();
        return dal;
    }

    async loadAccounts() {
        const result = localLedgerService.query(
            'SELECT * FROM accounts ORDER BY account');
        if (result.errors.length > 0) {
            console.error('Error loading accounts:', result.errors);
            Notifier.error('Failed to load accounts.' + 
                result.errors.map(e => e.message).join('; '));
            return [];
        }

        const accounts = result
            .rows
            .map(row => {
                let account = new Account(row[0] as string);
                account.currencies = row[3] as string[];
                return account;
            });
        return accounts;
    }

    // async loadPayees(): Promise<Payee[]> {
    //     const result = localLedgerService.query(
    //         'SELECT DISTINCT payee FROM transactions ORDER BY payee');
    //     if (result.errors.length > 0) {
    //         console.error('Error loading payees:', result.errors);
    //         Notifier.error('Failed to load payees.' + 
    //             result.errors.map(e => e.message).join('; '));
    //         return [];
    //     }

    //     const payees = result
    //         .rows.map(row => new Payee(row[0] as string));

    //     return payees;
	// }

    /**
     * For now, use the IndexedDB as we don't have all the payee records in OPFS.
     * @returns Array of Payee entities.
     */
    async loadPayees(): Promise<Payee[]> {
		return await db.payees.orderBy('name').toArray();
    }

}