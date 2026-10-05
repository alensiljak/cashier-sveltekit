/**
 * Access to the scheduled transactions (SCX). Everything outside the storage
 * layer goes through here, so the backing store can change without touching
 * the callers. Currently backed by the Dexie `scheduled` table.
 */
import db from '$lib/data/db';
import type { ScheduledTransaction, ScxId } from '$lib/data/model';

/** All scheduled transactions, by next date. */
export async function listScx(): Promise<ScheduledTransaction[]> {
	return db.scheduled.orderBy('nextDate').toArray();
}

export async function getScx(id: ScxId): Promise<ScheduledTransaction | undefined> {
	return db.scheduled.get(id);
}

export async function countScx(): Promise<number> {
	return db.scheduled.count();
}

/** Scheduled transactions whose next date is exactly `date` (YYYY-MM-DD). */
export async function listScxDueOn(date: string): Promise<ScheduledTransaction[]> {
	return db.scheduled.where('nextDate').equals(date).toArray();
}

/** Updates the record with `scx.id`, or adds a new one if it has none. Returns the ID. */
export async function saveScx(scx: ScheduledTransaction): Promise<ScxId> {
	if (!scx.id) {
		scx.id = new Date().getTime();
	}

	// The template must not carry a transaction id.
	if (scx.transaction && scx.transaction.id) {
		delete scx.transaction.id;
	}

	return (await db.scheduled.put(scx)) as ScxId;
}

/** Adds many as new records. Returns their IDs. */
export async function addScx(list: ScheduledTransaction[]): Promise<ScxId[]> {
	const ids: ScxId[] = [];
	for (const scx of list) ids.push((await db.scheduled.add(scx)) as ScxId);
	return ids;
}

export async function removeScx(ids: ScxId | ScxId[]): Promise<void> {
	await db.scheduled.bulkDelete(Array.isArray(ids) ? ids : [ids]);
}

/** Replaces all records with `list`, all-or-nothing. */
export async function replaceAllScx(list: ScheduledTransaction[]): Promise<void> {
	await db.transaction('rw', db.scheduled, async () => {
		await db.scheduled.clear();
		await db.scheduled.bulkPut(list);
	});
}
