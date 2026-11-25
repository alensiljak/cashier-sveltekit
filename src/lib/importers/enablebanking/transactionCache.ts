import type { EbTransaction, EbTransactionsQuery } from './api';

/** The request that "Load more" continues. */
export interface TxRequest {
	/** `accountKey` of the account the transactions belong to. */
	accountKey: string;
	/** The `daysBack` setting at the time of the request. */
	daysBack?: number;
	uid: string;
	query: EbTransactionsQuery;
	psuHeaders?: string[];
}

export interface CachedTransactions {
	request: TxRequest;
	/** All pages loaded so far. */
	transactions: EbTransaction[];
	continuationKey: string | null;
	/** ISO timestamp of the first page's fetch. */
	fetchedAt: string;
}

/**
 * The transactions last shown on the operations page, so that returning to it
 * does not call the bank again. Held in memory only: it outlives navigation
 * within the app, but not a reload.
 */
let cache: CachedTransactions | null = null;

export function rememberTransactions(entry: CachedTransactions): void {
	cache = entry;
}

export function recallTransactions(): CachedTransactions | null {
	return cache;
}
