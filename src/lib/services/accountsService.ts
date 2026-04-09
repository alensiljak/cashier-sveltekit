/**
 * The operations on the Accounts data.
 * It should simply use the cached versions of API requests,
 * and parse them when needed.
 * No other local storage is used.
 *
 * Use as:
 * import * as AccountService from 'accountService'
 */
import { Account, Money } from '$lib/data/model';
// import db from '$lib/data/db';
import { SettingKeys, settings } from '$lib/settings';
import appService from './appService';
import fullLedgerService from './ledgerWorkerClient';
import { addDecimalStrings } from '$lib/utils/numberUtils';

type QueryFn = (bql: string) => Promise<{ columns: string[]; rows: any[]; errors: any[] }>;

// export async function createDefaultAccounts() {
// 	const accountsList = getDefaultChartOfAccounts();
// 	await createAccounts(accountsList);
// }

/**
 * Creates accounts in the db, from a string list.
 * @param accountsList List of accounts, one account full name per line
 */
// async function createAccounts(accountsList: string) {
// 	let accountNames = accountsList.split('\n');
// 	// trim
// 	accountNames = accountNames.map((account) => account.trim());
// 	accountNames = accountNames.filter((account) => account);

// 	// create objects
// 	// const accounts = accountNames.map((accountName) => new Account(accountName))
// 	const accounts = accountNames.map((accountName) => {
// 		return {
// 			name: accountName
// 		};
// 	});
// 	await db.accounts.bulkAdd(accounts);
// }


// oxlint-disable-next-line no-unused-vars
function getDefaultChartOfAccounts() {
	const accountsList = `
    Assets:Cash
    Assets:Bank Accounts:Checking
    Assets:Bank Accounts:Savings
    Assets:Fixed Assets
    Assets:Investments:Cash
    Assets:Investments:Stocks
    Assets:Retirement
    Equity:Opening Balances
    Expenses:Auto:Accessories
    Expenses:Auto:Auto Insurance
    Expenses:Auto:Car Wash
    Expenses:Auto:Fuel
    Expenses:Auto:Parking
    Expenses:Auto:Registration
    Expenses:Auto:Service
    Expenses:Auto:Tickets
    Expenses:Auto:Toll
    Expenses:Auto:Tyres
    Expenses:Charity
    Expenses:Clothing:Clothes
    Expenses:Clothing:Footwear
    Expenses:Commissions
    Expenses:Culture:Books
    Expenses:Culture:Cinema
    Expenses:Culture:Museums
    Expenses:Culture:Music
    Expenses:Culture:Photo
    Expenses:Culture:Printing
    Expenses:Culture:Sightseeing
    Expenses:Culture:Stationary
    Expenses:Education
    Expenses:Financial:Bank Charge
    Expenses:Financial:Interest
    Expenses:Food
    Expenses:Gifts Given
    Expenses:Health:Dental
    Expenses:Health:Diagnostics
    Expenses:Health:Doctor
    Expenses:Health:Medicines
    Expenses:Health:Optical
    Expenses:Health:Products
    Expenses:Home:Appliances
    Expenses:Home:Furniture
    Expenses:Home:Maintenance
    Expenses:Home:Repairs
    Expenses:Home:Furnishing
    Expenses:Home:Tools
    Expenses:Home:Utensils
    Expenses:Hospitality:Accommodation
    Expenses:Hospitality:Dining
    Expenses:Hospitality:Drinks
    Expenses:Housing:Building Maintenance
    Expenses:Housing:Electricity
    Expenses:Housing:Gas
    Expenses:Housing:Mortgage Fees
    Expenses:Housing:Property Tax
    Expenses:Housing:Gas Service
    Expenses:InfoComm:Electronics
    Expenses:InfoComm:Hardware
    Expenses:InfoComm:Internet
    Expenses:InfoComm:Mobile Services
    Expenses:InfoComm:Phone
    Expenses:InfoComm:Services
    Expenses:InfoComm:Service Fees
    Expenses:InfoComm:Software
    Expenses:Insurance:Health Insurance
    Expenses:Insurance:Life Insurance
    Expenses:Personal:Care
    Expenses:Personal:Hairdressing
    Expenses:Personal:Other
    Expenses:Recreation:Activities
    Expenses:Recreation:Durables
    Expenses:Recreation:Games
    Expenses:Recreation:Rides
    Expenses:Tax:Federal
    Expenses:Transport:Bus
    Expenses:Transport:Flights
    Expenses:Transport:Post
    Expenses:Transport:Public
    Expenses:Transport:Taxi
    Expenses:Transport:Train
    Expenses:Vacation:Package
    Income:Interest
    Income:Investments
    Income:Salary
    Income:Other
    Liabilities:Credit Cards
    Liabilities:Loans
    `;
	return accountsList;
}

/**
 * Returns account balance
 * @param account Account object
 * @param defaultCurrency The default currency
 * @returns The account balance in default currency or in the first currency found.
 */
export function getAccountBalance(account: Account, defaultCurrency?: string): Money {
	const result = new Money();
	// default value
	result.currency = defaultCurrency as string;

	// Are there any balance records?
	if (!account.balances) return result;

	if (defaultCurrency) {
		// Do we have a balance in the default currency?
		const defaultQuantity = account.balances[defaultCurrency];
		if (defaultQuantity) {
			result.quantity = defaultQuantity;
			result.currency = defaultCurrency;
			return result;
		}
	}

	// Otherwise take the first balance/currency.
	const currencies = Object.keys(account.balances);
	// if no balances, return the default currency.
	if (!currencies || currencies.length === 0) return result;

	const currency = currencies[0];
	result.quantity = account.balances[currency];
	result.currency = currency;
	return result;
}

export function getShortAccountName(accountName: string): string {
	const separatorIndex = accountName.lastIndexOf(':');
	return accountName.substring(separatorIndex + 1);
}

/**
 * Get all the investment accounts in a dictionary.
 * Start from the investment root setting, and include the commodity.
 * @returns Promise with investment accounts collection
 */
export async function loadInvestmentAccounts(
	queryFn: QueryFn = async (bql) => fullLedgerService.query(bql)
): Promise<Account[]> {
	const rootAccount = await settings.get(SettingKeys.rootInvestmentAccount);
	if (!rootAccount) {
		throw new Error('Root investment account not set!');
	}
	const currency = await appService.getDefaultCurrency();

	const bql = `SELECT account, str(value(sum(position), '${currency}')) as value,
        sum(position) as balances
		WHERE account ~ '^${rootAccount}'
		GROUP BY account
		HAVING number(value(sum(position), 'EUR')) != 0
		ORDER BY account`;
	// HAVING NOT empty(sum(position))

	const result = await queryFn(bql);
	if (result.errors.length > 0) {
		throw new Error(result.errors.map((e: any) => e.message).join('; '));
	}

	const accountIdx = result.columns.indexOf('account');
	const balancesIdx = result.columns.indexOf('balances');
	const valueIdx = result.columns.indexOf('value');

	return result.rows.map((row: any) => {
		const account = new Account(row[accountIdx]);

		// Source:
		// row[balancesIdx].positions is an array containing
		// { units: { 'number', 'currency' } }
		// Destination:
		// account.balances: { EUR: 100, USD: 200 }
		account.balances = row[balancesIdx].positions.reduce((acc: any, balance: any) => {
			// acc[balance.units.currency] = (acc[balance.units.currency] ?? 0) +
			//     parseFloat(balance.units.number);
			acc[balance.units.currency] = addDecimalStrings([
				acc[balance.units.currency]?.toString() ?? '0',
				balance.units.number
			]);
			return acc;
		}, {});

		// current value: str(value(...)) returns e.g. "1234.56 EUR" or structured object
		if (valueIdx !== -1 && row[valueIdx] != null) {
			const raw = row[valueIdx];
			if (typeof raw === 'object' && raw.number != null) {
				// Structured: { number, currency }
				account.currentValue = parseFloat(raw.number);
				account.currentCurrency = raw.currency ?? '';
			} else {
				const str = String(raw).trim();
				// Match a number (possibly negative, with commas/decimals) followed by a currency code
				const match = str.match(/^([−-]?[\d,]*\.?\d+)\s+(\S+)$/);
				if (match) {
					account.currentValue = parseFloat(match[1].replace(/,/g, '').replace('−', '-'));
					account.currentCurrency = match[2];
				}
			}
		}
		return account;
	});
}

export async function populateAccountBalances(accounts: Account[]) {
	const currency = await appService.getDefaultCurrency();

	accounts.forEach((acct) => (acct.balance = getAccountBalance(acct, currency)));
}

export async function loadAccount(name: string): Promise<Account> {
	const result = await fullLedgerService.query(`SELECT * FROM accounts WHERE account = '${name}'`);

	// validation

	if (result.errors.length > 0) {
		throw new Error(result.errors.map((e: any) => e.message).join('; '));
	}
	if (result.rows.length === 0) {
		const account = new Account(name);
		account.exists = false;
		return account;
	}
	if (result.rows.length > 1) {
		throw new Error(`Multiple accounts found with name "${name}"`);
	}

	const row = result.rows[0] as any;
	const accountIdx = result.columns.indexOf('account');
	const currenciesIdx = result.columns.indexOf('currencies');

	const account = new Account(row[accountIdx]);

	if (currenciesIdx !== -1 && row[currenciesIdx]) {
		const currencies: string[] = Array.from(row[currenciesIdx]);
		account.balances = Object.fromEntries(currencies.map((c) => [c, 0]));
	}

	return account;
}

