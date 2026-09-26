/*
    demoDataService tests: the sample data seeded next to the demo book
    (account groups, favourites, local transactions) and its removal.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/utils/opfslib', () => ({
	saveFile: vi.fn(async () => {}),
	deleteDirectory: vi.fn(async () => {})
}));
vi.mock('$lib/services/ledgerReload', () => ({ reloadLedgerFromOpfs: vi.fn(async () => {}) }));
vi.mock('$lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));

import db from '$lib/data/db';
import demoDataService from '$lib/services/demoDataService';
import {
	DeviceSettingKeys,
	SettingKeys,
	defaultAccountGroups,
	deviceSettings,
	settings,
	type AccountGroup
} from '$lib/settings';
import { setXactStore } from '$lib/storage/xactStoreRegistry';
import { CrdtXactStore } from '$lib/storage/crdtXactStore';

const INVESTMENTS_CASH = [
	'Assets:Investments:Brokerage:Cash-EUR',
	'Assets:Investments:Brokerage:Cash-AUD'
];

let dbCounter = 0;
let store: CrdtXactStore;

async function groups() {
	return (await settings.get<AccountGroup[]>(SettingKeys.accountGroups)) ?? [];
}

beforeEach(async () => {
	// A fresh in-memory IndexedDB database per test, so stores never share records.
	store = new CrdtXactStore(`demo-test-${dbCounter++}`, async () => 'test-device');
	setXactStore(store);
	await settings.set(SettingKeys.accountGroups, null);
	await settings.set(SettingKeys.favouriteAccounts, null);
	await settings.set(SettingKeys.forecastAccounts, null);
	await deviceSettings.set(DeviceSettingKeys.demoXactIds, null);
	await deviceSettings.set(DeviceSettingKeys.demoScxIds, null);
	await db.scheduled.clear();
});

const scheduledPayees = async () =>
	(await db.scheduled.orderBy('nextDate').toArray()).map(
		(s: { transaction: { payee: string } }) => s.transaction.payee
	);

describe('activateDemoData', () => {
	it('fills the account groups and adds an Investments group', async () => {
		await demoDataService.activateDemoData();

		const byTitle = Object.fromEntries((await groups()).map((g) => [g.title, g.accounts]));
		expect(byTitle['Cash Accounts']).toEqual(['Assets:Cash:Wallet', 'Assets:Cash:Travel']);
		expect(byTitle['Bank Accounts']).toEqual(['Assets:Bank:Checking']);
		expect(byTitle['Investments']).toEqual(INVESTMENTS_CASH);
	});

	it('marks two accounts as favourites', async () => {
		await demoDataService.activateDemoData();

		expect(await settings.get<string[]>(SettingKeys.favouriteAccounts)).toEqual([
			'Assets:Bank:Checking',
			'Liabilities:CreditCard'
		]);
	});

	it('adds the Wallet to the forecast', async () => {
		await demoDataService.activateDemoData();

		expect(await settings.get<string[]>(SettingKeys.forecastAccounts)).toEqual([
			'Assets:Cash:Wallet'
		]);
	});

	it('keeps forecast accounts the user already chose', async () => {
		await settings.set(SettingKeys.forecastAccounts, ['Assets:Mine']);

		await demoDataService.activateDemoData();

		expect(await settings.get<string[]>(SettingKeys.forecastAccounts)).toEqual(['Assets:Mine']);
	});

	it('seeds two local transactions and remembers their IDs', async () => {
		await demoDataService.activateDemoData();

		const listed = await store.list();
		expect(listed).toHaveLength(2);
		const ids = await deviceSettings.get<string[]>(DeviceSettingKeys.demoXactIds);
		expect(ids?.sort()).toEqual(listed.map((s) => s.id).sort());
	});

	it('seeds monthly scheduled transactions due in the next weeks and remembers their IDs', async () => {
		await demoDataService.activateDemoData();

		const scheduled = await db.scheduled.orderBy('nextDate').toArray();
		expect(scheduled.map((s: { transaction: { payee: string } }) => s.transaction.payee)).toEqual([
			'Landlord',
			'Fitness Club',
			'Savings Deposit'
		]);
		const today = new Date().toISOString().slice(0, 10);
		for (const scx of scheduled) {
			expect(scx.nextDate > today).toBe(true);
			expect(scx).toMatchObject({ period: 'months', count: 1 });
			expect(scx.transaction.date).toBe(scx.nextDate);
			// One posting is left without an amount, to be balanced by the app.
			expect(
				scx.transaction.postings.filter((p: { amount?: number }) => p.amount === undefined)
			).toHaveLength(1);
		}
		expect((await deviceSettings.get<number[]>(DeviceSettingKeys.demoScxIds))?.sort()).toEqual(
			scheduled.map((s: { id: number }) => s.id).sort()
		);
	});

	it('does not seed scheduled transactions when the user already has some', async () => {
		await db.scheduled.add({ nextDate: '2030-01-01', transaction: { payee: 'Mine' } });

		await demoDataService.activateDemoData();

		expect(await scheduledPayees()).toEqual(['Mine']);
		expect(await deviceSettings.get(DeviceSettingKeys.demoScxIds)).toBeNull();
	});

	it('keeps groups and favourites the user already set up', async () => {
		const own: AccountGroup[] = [{ title: 'Mine', accounts: ['Assets:Mine'] }];
		await settings.set(SettingKeys.accountGroups, own);
		await settings.set(SettingKeys.favouriteAccounts, ['Assets:Mine']);

		await demoDataService.activateDemoData();

		expect(await groups()).toEqual(own);
		expect(await settings.get<string[]>(SettingKeys.favouriteAccounts)).toEqual(['Assets:Mine']);
	});

	it('does not seed transactions into a store that already has some', async () => {
		await store.append(
			'2026-01-02 * "Mine" "Own entry"\n  Expenses:Dining  1.00 EUR\n  Assets:Cash:Wallet'
		);

		await demoDataService.activateDemoData();

		expect(await store.list()).toHaveLength(1);
		expect(await deviceSettings.get(DeviceSettingKeys.demoXactIds)).toBeNull();
	});
});

describe('removeDemoData', () => {
	it('removes the seeded transactions, favourites and demo accounts', async () => {
		await demoDataService.activateDemoData();

		await demoDataService.removeDemoData();

		expect(await store.list()).toHaveLength(0);
		expect(await deviceSettings.get(DeviceSettingKeys.demoXactIds)).toBeNull();
		expect(await settings.get<string[]>(SettingKeys.favouriteAccounts)).toEqual([]);
		const remaining = await groups();
		expect(remaining.every((g) => g.accounts.length === 0)).toBe(true);
		expect(remaining.map((g) => g.title)).toEqual(defaultAccountGroups.map((g) => g.title));
	});

	it('removes the demo forecast account but keeps any the user added', async () => {
		await demoDataService.activateDemoData();
		await settings.set(SettingKeys.forecastAccounts, ['Assets:Cash:Wallet', 'Assets:Mine']);

		await demoDataService.removeDemoData();

		expect(await settings.get<string[]>(SettingKeys.forecastAccounts)).toEqual(['Assets:Mine']);
	});

	it('removes the seeded scheduled transactions but not ones the user added', async () => {
		await demoDataService.activateDemoData();
		await db.scheduled.add({ nextDate: '2030-01-01', transaction: { payee: 'Mine' } });

		await demoDataService.removeDemoData();

		expect(await scheduledPayees()).toEqual(['Mine']);
		expect(await deviceSettings.get(DeviceSettingKeys.demoScxIds)).toBeNull();
	});

	it('leaves transactions the user added, and still removes an edited seeded one', async () => {
		await demoDataService.activateDemoData();
		const [seeded] = await store.list();
		await store.update(
			seeded.id,
			'2026-01-03 * "Edited" "Changed"\n  Expenses:Dining  2.00 EUR\n  Assets:Cash:Wallet'
		);
		const own = await store.append(
			'2026-01-02 * "Mine" "Own entry"\n  Expenses:Dining  1.00 EUR\n  Assets:Cash:Wallet'
		);

		await demoDataService.removeDemoData();

		expect((await store.list()).map((s) => s.id)).toEqual([own.id]);
	});

	it("keeps the Investments group when it holds the user's own accounts", async () => {
		await demoDataService.activateDemoData();
		const current = await groups();
		await settings.set(
			SettingKeys.accountGroups,
			current.map((g) =>
				g.title === 'Investments' ? { ...g, accounts: [...g.accounts, 'Assets:Mine'] } : g
			)
		);

		await demoDataService.removeDemoData();

		const investments = (await groups()).find((g) => g.title === 'Investments');
		expect(investments?.accounts).toEqual(['Assets:Mine']);
	});
});
