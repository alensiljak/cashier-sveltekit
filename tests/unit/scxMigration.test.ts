/*
    First-launch migration of the legacy Dexie `scheduled` table into the CRDT store,
    and the facade's first-access behaviour.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));

import db from '$lib/data/db';
import { CrdtScxStore } from '$lib/storage/crdtScxStore';
import { setScxStore } from '$lib/storage/scxStoreRegistry';
import { ensureScxStoreExists, scxMigrationPrompt } from '$lib/services/scxMigration';
import { countScx, listScx } from '$lib/services/scxService';

const legacy = (payee: string, nextDate = '2026-01-01') => ({
	nextDate,
	period: 'months',
	count: 1,
	endDate: null,
	transaction: { date: nextDate, payee, postings: [], meta: {} }
});

let counter = 0;
let store: CrdtScxStore;

beforeEach(async () => {
	store = new CrdtScxStore(`migration-test-${counter++}`);
	setScxStore(store);
	scxMigrationPrompt.set(null);
	await db.scheduled.clear();
});

const waitForPrompt = () => vi.waitFor(() => expect(get(scxMigrationPrompt)).not.toBeNull());
const payees = async () => (await store.list()).map((s) => s.transaction?.payee);

describe('ensureScxStoreExists', () => {
	it('creates an empty store without asking when there is nothing to migrate', async () => {
		await ensureScxStoreExists(store);

		expect(get(scxMigrationPrompt)).toBeNull();
		expect(await store.isInitialized()).toBe(true);
		expect(await store.count()).toBe(0);
	});

	it('does nothing for a store that already exists, even if legacy records remain', async () => {
		await store.initialize();
		await db.scheduled.add(legacy('Old'));

		await ensureScxStoreExists(store);

		expect(get(scxMigrationPrompt)).toBeNull();
		expect(await store.count()).toBe(0);
	});

	it('asks, and migrates the legacy records on request, leaving the legacy table alone', async () => {
		await db.scheduled.bulkAdd([legacy('Rent'), legacy('Gym', '2026-02-01')]);

		const done = ensureScxStoreExists(store);
		await waitForPrompt();
		expect(get(scxMigrationPrompt)?.count).toBe(2);
		get(scxMigrationPrompt)!.choose('migrate');
		await done;

		expect(get(scxMigrationPrompt)).toBeNull();
		expect(await payees()).toEqual(['Rent', 'Gym']);
		// Legacy numeric ids are replaced by store ids.
		expect((await store.list()).every((s) => typeof s.id === 'string')).toBe(true);
		expect(await db.scheduled.count()).toBe(2);
	});

	it('starts with an empty store on request, leaving the legacy table alone', async () => {
		await db.scheduled.add(legacy('Rent'));

		const done = ensureScxStoreExists(store);
		await waitForPrompt();
		get(scxMigrationPrompt)!.choose('empty');
		await done;

		expect(await store.isInitialized()).toBe(true);
		expect(await store.count()).toBe(0);
		expect(await db.scheduled.count()).toBe(1);
	});

	it('does not ask again once the store exists', async () => {
		await db.scheduled.add(legacy('Rent'));
		const first = ensureScxStoreExists(store);
		await waitForPrompt();
		get(scxMigrationPrompt)!.choose('empty');
		await first;

		await ensureScxStoreExists(store);

		expect(get(scxMigrationPrompt)).toBeNull();
	});
});

describe('scxService first access', () => {
	it('holds all access behind one prompt until the user chooses', async () => {
		await db.scheduled.add(legacy('Rent'));

		const list = listScx();
		const count = countScx();
		await waitForPrompt();
		const prompt = get(scxMigrationPrompt)!;
		let settled = false;
		void Promise.all([list, count]).then(() => (settled = true));
		await new Promise((r) => setTimeout(r, 20));
		expect(settled).toBe(false);

		prompt.choose('migrate');

		expect((await list).map((s) => s.transaction?.payee)).toEqual(['Rent']);
		expect(await count).toBe(1);
	});

	it('creates the store silently on a fresh install', async () => {
		expect(await listScx()).toEqual([]);

		expect(get(scxMigrationPrompt)).toBeNull();
		expect(await store.isInitialized()).toBe(true);
	});
});
