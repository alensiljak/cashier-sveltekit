/**
 * Store for the device's working set of transactions (the unarchived ones).
 *
 * Abstracts *where* those transactions live, so the editor and journal don't
 * care whether they are backed by the `cashier.bean` file in OPFS or (later)
 * by a Yjs document. Everything is expressed in Beancount text plus an ID
 * that identifies an existing transaction within the store.
 */
import type { Xact } from '$lib/data/model';

/**
 * Identifies a transaction within the active store. Opaque to callers: only
 * pass back what the store gave them. The file store uses the transaction's
 * start line (positional, so it is only valid until the next write); a Yjs
 * store would use a stable record ID.
 *
 * Not to be confused with the full ledger's numeric transaction id (`rledgerId`),
 * which exists only for read-only, already-archived transactions.
 */
export type XactId = string;

export interface StoredXact {
	xact: Xact;
	id: XactId;
	/** ID of the device that created the transaction (CRDT store only). */
	origin?: string;
}

export interface XactStore {
	readonly kind: 'opfs' | 'crdt';

	/** Whether the store has been set up on this device (each store defines what that means). */
	isInitialized(): Promise<boolean>;

	/** Set the store up as empty, marking it initialized. */
	initialize(): Promise<void>;

	/** Add a transaction. Returns it with its ID, ready to be edited in place. */
	append(beancountText: string): Promise<StoredXact>;

	/** Replace the transaction identified by `id`. Returns it with its new ID (it may move). */
	update(id: XactId, beancountText: string): Promise<StoredXact>;

	/** Remove the transaction identified by `id`. */
	remove(id: XactId): Promise<void>;

	/** All transactions, with their IDs. */
	list(): Promise<StoredXact[]>;

	/** The whole working set as Beancount source, for inclusion in the WASM ledger. */
	toBeancount(): Promise<string>;

	/** Remove every transaction. */
	clear(): Promise<void>;
}
