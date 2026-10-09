/**
 * Access to the scheduled transactions (SCX). Everything outside the storage
 * layer goes through here. Backed by the CRDT store; the first access on a
 * device creates it.
 */
import type { ScheduledTransaction, ScxId } from '#lib/data/model';
import type { CrdtScxStore } from '#lib/storage/crdtScxStore';
import { getScxStore } from '#lib/storage/scxStoreRegistry';

/** Creates the store on this device if it does not exist yet. */
async function ensureScxStoreExists(scxStore: CrdtScxStore): Promise<void> {
	if (!(await scxStore.isInitialized())) await scxStore.initialize();
}

const prepared = new WeakMap<CrdtScxStore, Promise<void>>();

/** The store, once it exists on this device. Concurrent first accesses share one preparation. */
async function store(): Promise<CrdtScxStore> {
	const scxStore = await getScxStore();
	let preparing = prepared.get(scxStore);
	if (!preparing) {
		preparing = ensureScxStoreExists(scxStore);
		prepared.set(scxStore, preparing);
		// A failure must not stick: the next access tries again.
		preparing.catch(() => prepared.delete(scxStore));
	}
	await preparing;
	return scxStore;
}

/**
 * The store itself, once it exists on this device (created if needed). For sync code
 * that exchanges the document's state; background work that mustn't create it checks
 * `isInitialized()` on `getScxStore()` instead.
 */
export async function getReadyScxStore(): Promise<CrdtScxStore> {
	return store();
}

/** All scheduled transactions, by next date. */
export async function listScx(): Promise<ScheduledTransaction[]> {
	return (await store()).list();
}

export async function getScx(id: ScxId): Promise<ScheduledTransaction | undefined> {
	return (await store()).get(id);
}

export async function countScx(): Promise<number> {
	return (await store()).count();
}

/** Scheduled transactions whose next date is exactly `date` (YYYY-MM-DD). */
export async function listScxDueOn(date: string): Promise<ScheduledTransaction[]> {
	return (await store()).dueOn(date);
}

/** Updates the record with `scx.id`, or adds a new one if it has none. Returns the ID. */
export async function saveScx(scx: ScheduledTransaction): Promise<ScxId> {
	return (await store()).save(scx);
}

/** Adds many as new records. Returns their IDs. */
export async function addScx(list: ScheduledTransaction[]): Promise<ScxId[]> {
	return (await store()).addMany(list);
}

export async function removeScx(ids: ScxId | ScxId[]): Promise<void> {
	await (await store()).removeMany(Array.isArray(ids) ? ids : [ids]);
}

/** Replaces all records with `list` (as new records), in one update. */
export async function replaceAllScx(list: ScheduledTransaction[]): Promise<void> {
	await (await store()).replaceAll(list);
}
