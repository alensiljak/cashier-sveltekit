/**
 * Shared "reload ledger" logic used by the import-ledger, sync, and home
 * pages. Re-parses the ledger from OPFS source files and refreshes the
 * staleness-check metadata snapshot in the same step, so the homepage
 * "modified" indicator is never left out of sync after a manual reload.
 */

import fullLedgerService from '$lib/services/ledgerWorkerClient';
import { saveOpfsMetaSnapshot } from '$lib/services/opfsMetaCheck';

/** Free and re-parse the ledger from OPFS, then rebase the staleness snapshot. */
export async function reloadLedgerFromOpfs(): Promise<void> {
	await fullLedgerService.invalidate();
	await saveOpfsMetaSnapshot();
}
