/**
 * File-System-based Data Access Layer (FSDAL).
 * All data is loaded from the filesystem and provided by BQL queries from Rust Ledger WASM.
 */

import fullLedgerService from "$lib/services/fullLedgerService";
import Notifier from "$lib/utils/notifier";
import type { DAL } from "./dal";
import { Payee } from "./model";

export default class FSDAL implements DAL {
    constructor() {
        fullLedgerService.ensureLoaded();
    }

    async loadPayees(): Promise<Payee[]> {
		//return db.payees.orderBy('name');
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