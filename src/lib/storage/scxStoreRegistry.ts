import type { CrdtScxStore } from './crdtScxStore';

/**
 * The active scheduled-transactions store. Every consumer gets it through
 * `getScxStore()`, which creates it on first use and hands out the same store
 * afterwards, so nothing has to initialise it in a particular order.
 */
let active: Promise<CrdtScxStore> | undefined;

export function getScxStore(): Promise<CrdtScxStore> {
	active ??= resolveStore();
	return active;
}

/**
 * Calls `callback` on every change to the store's scheduled transactions.
 * Synchronous for the caller (the store resolves in the background), so it fits
 * a Svelte `$effect`: `$effect(() => subscribeScxStore(load))`.
 * Returns the unsubscribe function.
 */
export function subscribeScxStore(callback: () => void): () => void {
	let unsubscribe: (() => void) | undefined;
	let cancelled = false;
	void getScxStore().then((store) => {
		if (!cancelled) unsubscribe = store.subscribe(callback);
	});
	return () => {
		cancelled = true;
		unsubscribe?.();
	};
}

/** Replace the active store (e.g. in tests). */
export function setScxStore(store: CrdtScxStore): void {
	active = Promise.resolve(store);
}

async function resolveStore(): Promise<CrdtScxStore> {
	// Imported on demand: the store imports webdavAutoBackupService, which may import this module.
	const { CrdtScxStore } = await import('./crdtScxStore');
	return new CrdtScxStore();
}
