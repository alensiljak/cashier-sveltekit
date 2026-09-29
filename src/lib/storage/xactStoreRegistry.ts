import type { CrdtXactStore } from './crdtXactStore';

/**
 * The active working-set store: always the CRDT store. Every consumer —
 * LedgerService, the editor, the journal — gets it through `getXactStore()`,
 * which creates it on first use and hands out the same store afterwards. So
 * the result is correct whichever caller comes first; nothing has to
 * initialise it in a particular order.
 */
let active: Promise<CrdtXactStore> | undefined;

export function getXactStore(): Promise<CrdtXactStore> {
	active ??= resolveStore();
	return active;
}

/**
 * Calls `callback` on every change to the active store's transactions.
 * Synchronous for the caller (the store resolves in the background), so it fits
 * a Svelte `$effect`: `$effect(() => subscribeXactStore(load))`.
 * Returns the unsubscribe function.
 */
export function subscribeXactStore(callback: () => void): () => void {
	let unsubscribe: (() => void) | undefined;
	let cancelled = false;
	void getXactStore().then((store) => {
		if (!cancelled) unsubscribe = store.subscribe(callback);
	});
	return () => {
		cancelled = true;
		unsubscribe?.();
	};
}

/** Replace the active store (e.g. in tests). */
export function setXactStore(store: CrdtXactStore): void {
	active = Promise.resolve(store);
}

async function resolveStore(): Promise<CrdtXactStore> {
	// Imported on demand: crdtXactStore imports webdavAutoBackupService, which
	// imports this module, so a static import would be circular.
	const { CrdtXactStore } = await import('./crdtXactStore');
	return new CrdtXactStore();
}
