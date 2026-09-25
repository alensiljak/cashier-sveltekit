import { OpfsXactStore } from './opfsXactStore';
import type { XactStore } from './xactStore';

/**
 * The active working-set store. Defaults to the `cashier.bean` file in OPFS;
 * swap it with `setXactStore()` (e.g. for a Yjs-backed store) and every
 * consumer — LedgerService, the editor, the journal — follows.
 */
let active: XactStore = new OpfsXactStore();

export function getXactStore(): XactStore {
	return active;
}

export function setXactStore(store: XactStore): void {
	active = store;
}
