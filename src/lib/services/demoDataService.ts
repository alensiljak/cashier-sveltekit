/*
	Manages the bundled demo book: activating it (write the static fixtures into
	OPFS and point the app's book/asset-allocation settings at them) and removing
	it again. Demo content is read-only reference data — the only file the app
	ever appends to is `cashier.bean` (see constants.ts), which this service
	never touches.
*/
import * as OpfsLib from '$lib/utils/opfslib';
import db from '$lib/data/db';
import { Posting, ScheduledTransaction, Xact } from '$lib/data/model';
import { RecurrencePeriods } from '$lib/enums';
import {
	settings,
	deviceSettings,
	SettingKeys,
	DeviceSettingKeys,
	defaultAccountGroups,
	type AccountGroup
} from '$lib/settings';
import { getXactStore } from '$lib/storage/xactStoreRegistry';
import {
	USER_BOOK_FILENAME,
	DEMO_DIR,
	DEMO_BOOK_FILE,
	DEMO_ACCOUNTS_FILE,
	DEMO_COMMODITIES_FILE,
	DEMO_PRICES_FILE,
	DEMO_AA_FILE,
	DEMO_ROOT_INVESTMENT_ACCOUNT
} from '$lib/constants';
import { reloadLedgerFromOpfs } from './ledgerReload';

// Vite glob-imports the fixtures as raw strings, resolved at build time —
// works offline, no runtime fetch. Same pattern as $lib/help/helpContent.ts.
const fixtures = import.meta.glob('$lib/demo/fixtures/*', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

/** Demo accounts placed into the default account groups, by group title. */
const DEMO_GROUP_ACCOUNTS: Record<string, string[]> = {
	'Cash Accounts': ['Assets:Cash:Wallet', 'Assets:Cash:Travel'],
	'Bank Accounts': ['Assets:Bank:Checking'],
	'Savings Accounts': ['Assets:Bank:Savings'],
	'Credit Cards': ['Liabilities:CreditCard'],
	// Not one of the default groups; added by the demo (see `seedAccountGroups`).
	Investments: ['Assets:Investments:Brokerage:Cash-EUR', 'Assets:Investments:Brokerage:Cash-AUD']
};
const DEMO_INVESTMENTS_GROUP = 'Investments';

/** Demo accounts marked as favourites. */
const DEMO_FAVOURITE_ACCOUNTS = ['Assets:Bank:Checking', 'Liabilities:CreditCard'];

/** Demo accounts included in the financial forecast. */
const DEMO_FORECAST_ACCOUNTS = ['Assets:Cash:Wallet'];

/** Two recent local (unarchived) transactions, so the Device Journal isn't empty. */
function demoLocalXacts(): string[] {
	const day = (offset: number) => {
		const d = new Date();
		d.setDate(d.getDate() - offset);
		return d.toISOString().slice(0, 10);
	};
	return [
		`${day(1)} * "Corner Cafe" "Coffee"\n  Expenses:Dining    4.50 EUR\n  Assets:Cash:Wallet`,
		`${day(0)} * "Supermarket" "Groceries"\n  Expenses:Groceries    27.80 EUR\n  Liabilities:CreditCard`
	];
}

/** Monthly scheduled transactions, due over the next few weeks, so the scheduled views aren't empty. */
function demoScheduledXacts(): ScheduledTransaction[] {
	const inDays = (offset: number) => {
		const d = new Date();
		d.setDate(d.getDate() + offset);
		return d.toISOString().slice(0, 10);
	};
	const monthly = (
		daysAhead: number,
		payee: string,
		note: string,
		postings: [account: string, amount?: number][]
	) => {
		const scx = new ScheduledTransaction();
		scx.nextDate = inDays(daysAhead);
		scx.period = RecurrencePeriods.Months;
		scx.count = 1;
		scx.endDate = null;

		const xact = Xact.create();
		xact.date = scx.nextDate;
		xact.payee = payee;
		xact.note = note;
		xact.postings = postings.map(([account, amount]) => {
			const posting = new Posting();
			posting.account = account;
			posting.currency = 'EUR';
			if (amount !== undefined) posting.amount = amount;
			return posting;
		});
		scx.transaction = xact;
		return scx;
	};
	return [
		monthly(3, 'Landlord', 'Rent', [['Expenses:Rent', 900], ['Assets:Bank:Checking']]),
		monthly(10, 'Fitness Club', 'Gym membership', [
			['Expenses:Entertainment', 35],
			['Liabilities:CreditCard']
		]),
		monthly(20, 'Savings Deposit', 'Monthly savings', [
			['Assets:Bank:Savings', 200],
			['Assets:Bank:Checking']
		])
	];
}

function fixture(name: string): string {
	const entry = Object.entries(fixtures).find(([path]) => path.endsWith(`/${name}`));
	if (!entry) throw new Error(`Demo fixture not found: ${name}`);
	return entry[1];
}

class DemoDataService {
	/**
	 * Writes the bundled demo fixtures into OPFS under `DEMO_DIR` and links
	 * them as the active book / asset-allocation definition. Always
	 * overwrites `DEMO_DIR` contents (they're static, versioned with the app)
	 * but never touches `cashier.bean` or any of the user's own files.
	 */
	async activateDemoData(): Promise<void> {
		await OpfsLib.saveFile(DEMO_BOOK_FILE, fixture('book.bean'));
		await OpfsLib.saveFile(DEMO_ACCOUNTS_FILE, fixture('accounts.bean'));
		await OpfsLib.saveFile(DEMO_COMMODITIES_FILE, fixture('commodities.bean'));
		await OpfsLib.saveFile(DEMO_PRICES_FILE, fixture('prices.bean'));
		await OpfsLib.saveFile(DEMO_AA_FILE, fixture('asset-allocation.toml'));

		await settings.set(USER_BOOK_FILENAME, DEMO_BOOK_FILE);
		await settings.set(SettingKeys.assetAllocationDefinition, DEMO_AA_FILE);
		await settings.set(SettingKeys.rootInvestmentAccount, DEMO_ROOT_INVESTMENT_ACCOUNT);
		// AA valuation queries require a default currency; the demo book is
		// EUR-only, so seed it if the user hasn't chosen one yet — never
		// override an existing preference.
		if (!(await settings.get<string>(SettingKeys.currency))) {
			await settings.set(SettingKeys.currency, 'EUR');
		}

		await this.seedAccountGroups();
		await this.seedFavourites();
		await this.seedForecastAccounts();
		await this.seedLocalXacts();
		await this.seedScheduledXacts();

		await reloadLedgerFromOpfs();
	}

	/** Fills the default account groups with demo accounts, unless the user already grouped accounts. */
	private async seedAccountGroups(): Promise<void> {
		const stored = await settings.get<AccountGroup[]>(SettingKeys.accountGroups);
		const groups = stored && stored.length > 0 ? stored : defaultAccountGroups;
		if (groups.some((g) => g.accounts.length > 0)) return;
		const seeded = groups.map((g) => ({
			...g,
			accounts: DEMO_GROUP_ACCOUNTS[g.title] ?? g.accounts
		}));
		if (!seeded.some((g) => g.title === DEMO_INVESTMENTS_GROUP)) {
			seeded.push({
				title: DEMO_INVESTMENTS_GROUP,
				accounts: DEMO_GROUP_ACCOUNTS[DEMO_INVESTMENTS_GROUP]
			});
		}
		await settings.set(SettingKeys.accountGroups, seeded);
	}

	/** Marks two demo accounts as favourites, unless the user already has some. */
	private async seedFavourites(): Promise<void> {
		const stored = (await settings.get<string[]>(SettingKeys.favouriteAccounts)) ?? [];
		if (stored.length > 0) return;
		await settings.set(SettingKeys.favouriteAccounts, DEMO_FAVOURITE_ACCOUNTS);
	}

	/** Adds the Wallet to the forecast, unless the user already chose forecast accounts. */
	private async seedForecastAccounts(): Promise<void> {
		const stored = (await settings.get<string[]>(SettingKeys.forecastAccounts)) ?? [];
		if (stored.length > 0) return;
		await settings.set(SettingKeys.forecastAccounts, DEMO_FORECAST_ACCOUNTS);
	}

	/** Adds sample transactions to an empty device store and remembers their IDs. */
	private async seedLocalXacts(): Promise<void> {
		const store = await getXactStore();
		// OPFS-store IDs are positional and go stale, so only the CRDT store can be cleaned up later.
		if (store.kind !== 'crdt' || (await store.list()).length > 0) return;
		const ids: string[] = [];
		for (const text of demoLocalXacts()) {
			ids.push((await store.append(text)).id);
		}
		await deviceSettings.set(DeviceSettingKeys.demoXactIds, ids);
	}

	/** Adds sample scheduled transactions when there are none, and remembers their IDs. */
	private async seedScheduledXacts(): Promise<void> {
		if ((await db.scheduled.count()) > 0) return;
		const ids: number[] = [];
		for (const scx of demoScheduledXacts()) {
			ids.push((await db.scheduled.add(scx)) as number);
		}
		await deviceSettings.set(DeviceSettingKeys.demoScxIds, ids);
	}

	/** Removes the seeded sample transactions and demo accounts from the favourites and groups. */
	private async removeSeeded(): Promise<void> {
		const ids = await deviceSettings.get<string[]>(DeviceSettingKeys.demoXactIds);
		if (ids?.length) {
			const store = await getXactStore();
			for (const id of ids) await store.remove(id);
		}
		await deviceSettings.set(DeviceSettingKeys.demoXactIds, null);

		const scxIds = await deviceSettings.get<number[]>(DeviceSettingKeys.demoScxIds);
		if (scxIds?.length) await db.scheduled.bulkDelete(scxIds);
		await deviceSettings.set(DeviceSettingKeys.demoScxIds, null);

		const favourites = await settings.get<string[]>(SettingKeys.favouriteAccounts);
		if (favourites) {
			await settings.set(
				SettingKeys.favouriteAccounts,
				favourites.filter((a) => !DEMO_FAVOURITE_ACCOUNTS.includes(a))
			);
		}

		const forecast = await settings.get<string[]>(SettingKeys.forecastAccounts);
		if (forecast) {
			await settings.set(
				SettingKeys.forecastAccounts,
				forecast.filter((a) => !DEMO_FORECAST_ACCOUNTS.includes(a))
			);
		}

		const demoAccounts = new Set(Object.values(DEMO_GROUP_ACCOUNTS).flat());
		const groups = await settings.get<AccountGroup[]>(SettingKeys.accountGroups);
		if (groups) {
			await settings.set(
				SettingKeys.accountGroups,
				groups
					.map((g) => ({ ...g, accounts: g.accounts.filter((a) => !demoAccounts.has(a)) }))
					// The demo-added group goes away once it holds nothing of the user's.
					.filter((g) => g.title !== DEMO_INVESTMENTS_GROUP || g.accounts.length > 0)
			);
		}
	}

	/**
	 * Deletes `DEMO_DIR` and unlinks any settings currently pointing at it.
	 * Settings are only cleared if they still match the demo paths, so this
	 * is safe to call even if the user has since pointed elsewhere.
	 */
	async removeDemoData(): Promise<void> {
		const bookFilename = await settings.get<string>(USER_BOOK_FILENAME);
		if (bookFilename === DEMO_BOOK_FILE) {
			await settings.set(USER_BOOK_FILENAME, null);
		}

		const aaDefinition = await settings.get<string>(SettingKeys.assetAllocationDefinition);
		if (aaDefinition === DEMO_AA_FILE) {
			await settings.set(SettingKeys.assetAllocationDefinition, null);
		}

		const rootInvestmentAccount = await settings.get<string>(SettingKeys.rootInvestmentAccount);
		if (rootInvestmentAccount === DEMO_ROOT_INVESTMENT_ACCOUNT) {
			await settings.set(SettingKeys.rootInvestmentAccount, null);
		}

		await this.removeSeeded();
		await OpfsLib.deleteDirectory(DEMO_DIR);
		await reloadLedgerFromOpfs();
	}

	/** True if the demo book is the currently-linked user book. */
	async isDemoActive(): Promise<boolean> {
		const bookFilename = await settings.get<string>(USER_BOOK_FILENAME);
		return bookFilename === DEMO_BOOK_FILE;
	}
}

export default new DemoDataService();
