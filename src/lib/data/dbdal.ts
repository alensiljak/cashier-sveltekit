/**
 * Data Access Layer for permanent storage (indexeddb)
 */

import { ScheduledTransaction } from '$lib/data/model';
import db from '$lib/data/db';

export async function saveScheduledTransaction(stx: ScheduledTransaction) {
	if (!stx.id) {
		stx.id = new Date().getTime();
	}

	// clear any transaction ids!
	if (stx.transaction && stx.transaction.id) {
		delete stx.transaction.id;
	}

	const result = await db.scheduled.put(stx);

	return result;
}
