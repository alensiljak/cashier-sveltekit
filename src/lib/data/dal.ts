/**
 * Common Data Access Layer (DAL) code.
 */

import type { Payee } from "./model";

export interface DAL {
    loadPayees(): Promise<Payee[]>
}
