import type { StoredXact, XactId, XactStore } from './xactStore';

const NOT_IMPLEMENTED = 'CrdtXactStore is not implemented yet';

/**
 * Working set kept in a CRDT document (Yjs, planned). Transactions are
 * identified by a stable record ID, so an ID stays valid across writes.
 *
 * Skeleton only: no CRDT dependency has been added yet.
 */
export class CrdtXactStore implements XactStore {
	readonly kind = 'crdt';

	async append(_beancountText: string): Promise<StoredXact> {
		throw new Error(NOT_IMPLEMENTED);
	}

	async update(_id: XactId, _beancountText: string): Promise<StoredXact> {
		throw new Error(NOT_IMPLEMENTED);
	}

	async remove(_id: XactId): Promise<void> {
		throw new Error(NOT_IMPLEMENTED);
	}

	async list(): Promise<StoredXact[]> {
		throw new Error(NOT_IMPLEMENTED);
	}

	async toBeancount(): Promise<string> {
		throw new Error(NOT_IMPLEMENTED);
	}

	async clear(): Promise<void> {
		throw new Error(NOT_IMPLEMENTED);
	}
}
