/**
 * One-time move of the scheduled transactions from the legacy Dexie `scheduled`
 * table into the CRDT store.
 *
 * TODO: remove this file, `ScxMigrationDialog.svelte` and its mount in
 * `+layout.svelte` once the `scheduled` table is dropped from the Dexie schema
 * (see the TODO in `db.ts`).
 *
 * Runs when the CRDT store is first accessed on a device and does not exist yet:
 * - no legacy records: the store is simply created empty;
 * - legacy records: the user chooses to migrate them (do this on one device
 *   only), or to start with an empty store and receive the records through sync.
 *   The legacy table is left untouched either way.
 */
import { writable } from 'svelte/store';
import db from '$lib/data/db';
import type { CrdtScxStore } from '$lib/storage/crdtScxStore';

export type ScxMigrationChoice = 'migrate' | 'empty';

/** Set while the user's choice is awaited; the layout shows a dialog for it. */
export const scxMigrationPrompt = writable<{
	count: number;
	choose: (choice: ScxMigrationChoice) => void;
} | null>(null);

function askForChoice(count: number): Promise<ScxMigrationChoice> {
	return new Promise((resolve) => {
		scxMigrationPrompt.set({
			count,
			choose: (choice) => {
				scxMigrationPrompt.set(null);
				resolve(choice);
			}
		});
	});
}

/** Copies the legacy records into the store as new records (new IDs), in one update. */
export async function migrateLegacyScx(store: CrdtScxStore): Promise<void> {
	await store.addMany(await db.scheduled.toArray());
}

/**
 * Makes sure the store exists on this device, asking the user first if there
 * is legacy data to migrate. Resolves once the store is usable.
 */
export async function ensureScxStoreExists(store: CrdtScxStore): Promise<void> {
	if (await store.isInitialized()) return;

	const count = await db.scheduled.count();
	if (count === 0) {
		await store.initialize();
		return;
	}

	if ((await askForChoice(count)) === 'migrate') {
		await migrateLegacyScx(store);
	} else {
		await store.initialize();
	}
}
