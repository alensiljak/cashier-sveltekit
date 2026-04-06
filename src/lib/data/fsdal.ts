/**
 * File-System-based Data Access Layer (FSDAL).
 * All data is loaded from the filesystem and provided by BQL queries from Rust Ledger WASM.
 */

import fullLedgerService from "$lib/services/fullLedgerService";
import Notifier from "$lib/utils/notifier";
import type { DAL } from "./dal";
import { Account, Payee } from "./model";

export default class FSDAL implements DAL {
    private constructor() {}

    static async create(): Promise<FSDAL> {
        const dal = new FSDAL();
        await fullLedgerService.ensureLoaded();
        return dal;
    }

    async loadAccounts() {
        const result = fullLedgerService.query(
            'SELECT * FROM accounts ORDER BY account');
        if (result.errors.length > 0) {
            console.error('Error loading accounts:', result.errors);
            Notifier.error('Failed to load accounts.' + 
                result.errors.map(e => e.message).join('; '));
            return [];
        }

        // return (result?.rows ?? []).map((row: any[]) => ({
		// 	account: row[0],
		// 	open: row[1],
		// 	close: row[2],
		// 	currencies: row[3],
		// 	booking: row[4]
		// }));

        const accounts = result
            .rows.map(row => row[0] as string)
            .map(name => new Account(name));
        return accounts;
    }

    async loadPayees(): Promise<Payee[]> {
        const result = fullLedgerService.query(
            'SELECT DISTINCT payee FROM transactions ORDER BY payee');
        if (result.errors.length > 0) {
            console.error('Error loading payees:', result.errors);
            Notifier.error('Failed to load payees.' + 
                result.errors.map(e => e.message).join('; '));
            return [];
        }

        const payees = result
            .rows.map(row => new Payee(row[0] as string));

        return payees;
	}

}