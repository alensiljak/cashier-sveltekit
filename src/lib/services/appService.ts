/*
    Provide service layer for the application.

    https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/export
*/
import db from '$lib/data/db';
import {
	Account,
	//Money,
	LastXact,
	Payee,
	Posting,
	ScheduledTransaction,
	Xact
} from '$lib/data/model';
import { settings, SettingKeys } from '$lib/settings';
import { XactAugmenter } from '$lib/utils/xactAugmenter';
import { HomeCardNames } from '$lib/enums';
import { DefaultCurrencyStore, ScheduledXact, xact } from '$lib/data/mainStore';
import { loadInvestmentAccounts } from './accountsService';
import { get } from 'svelte/store';
import * as LedgerParser from '$lib/utils/ledgerParser';
import * as BeancountParser from '$lib/utils/beancountParser';
import { formatAmount } from '$lib/utils/formatter';

interface AccountIndex {
	[key: string]: Account;
}

class AppService {
	/**
	 * Clears Ids and reference Ids in Xact and Postings.
	 * @param {Xact} tx
	 */
	clearIds(tx: Xact) {
		delete tx.id;
		// tx.postings.forEach((posting: Posting) => {
		//   delete posting.id
		//   // delete posting.transactionId
		// })
		return tx;
	}

	createAccount(name: string) {
		const acc = new Account(name);
		return db.accounts.add(acc);
	}

	createXactFrom(existing: Xact): Xact {
		const newXact = new Xact();
		newXact.date = existing.date;
		newXact.payee = existing.payee;
		newXact.note = existing.note;

		// postings
		if (existing.postings) {
			newXact.postings = [...existing.postings];
		}

		return newXact;
	}

	get db() {
		return db;
	}

	deleteAccount(name: string) {
		return db.accounts.delete(name);
	}

	async deleteAccounts() {
		return db.accounts.clear();
	}

	/**
	 * Delete transaction and related postings.
	 * @param {*} id Int/long id of the transaction to delete
	 */
	async deleteTransaction(id: number) {
		if (typeof id === 'string') {
			id = Number(id);
		}

		// await this.db.Transaction(
		//   'rw',
		//   this.db.transactions,
		//   // this.db.postings,
		//   async (tx: Xact) => {
		//     const x = await db.transactions.where('id').equals(id).count()

		//     // delete transaction record
		//     const result = await db.transactions.where('id').equals(id).delete()

		//     // delete postings
		//     // result = await db.postings.where('transactionId').equals(id).delete()

		//     return 'Transaction complete'
		//   },
		// )
		await this.db.xacts.delete(id);

		console.log('Delete transaction completed.', id);
		//.catch(error => console.error('Error on Delete Transaction:', error))
	}

	/**
	 * Delete all transactions.
	 */
	async deleteTransactions() {
		// also clear any remaining postings
		// this.db.postings.clear()
		await this.db.xacts.clear();
	}

	async duplicateTransaction(tx: Xact) {
		// copy a new transaction
		const newTx = $state.raw(tx);

		this.clearIds(newTx);

		// return the transaction
		return newTx;
	}

	/**
	 * Returns all the register transactions as text,
	 * ready to be exported as a file or copied as a string.
	 */
	async getExportTransactions() {
		const txs = await db.xacts.orderBy('date').toArray();

		let output = '';

		for (let i = 0; i < txs.length; i++) {
			const tx = txs[i];

			if (i > 0) {
				output += '\n'; // space between transactions
			}

			// prepare output.
			const output_system = await settings.get(SettingKeys.ptaSystem);
			if (output_system === 'ledger') {
				output += this.translateToLedger(tx);
			} else {
				output += this.translateToBeancount(tx);
			}
		}
		return output;
	}

	async getVisibleCards(): Promise<string[]> {
		let visibleCardNames: string[] = await settings.get(SettingKeys.visibleCards);
		if (!visibleCardNames) {
			// create the default cards list here
			visibleCardNames = [
				HomeCardNames.FAVOURITES,
				HomeCardNames.JOURNAL,
				HomeCardNames.SCHEDULED,
				HomeCardNames.SYNC,
				HomeCardNames.FORECAST
			];
		}
		return visibleCardNames;
	}

	/**
	 * Load data from a file.
	 * @param {FileInfo} fileInfo The file info from the input control.
	 * @param {Function} callback A function to run when complete, passing the file content.
	 */
	readFile(fileInfo: Blob, callback: (content: unknown) => void): void {
		if (!fileInfo) return;

		const reader = new FileReader();

		reader.onload = (event) => {
			// File was successfully read.
			const content = event.target?.result;

			callback(content);
		};

		reader.readAsText(fileInfo);
	}

	async readFileAsync(fileInfo: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			if (!fileInfo) reject('FileInfo must be sent!');

			const reader = new FileReader();

			reader.onload = (event) => {
				// File was successfully read.
				const content = event?.target?.result;

				resolve(content as string);
			};
			reader.onerror = (error) => {
				reject(error);
			};

			reader.readAsText(fileInfo);
		});
	}

	/**
	 * Translates Xact into a beancount entry.
	 * @param {Xact} tx
	 * @returns {String} A beancount journal entry
	 */
	translateToBeancount(tx: Xact) {
		let output = '';

		// transaction
		output += tx.date;
		output += ' txn "' + tx.payee + '"';
		// note
		if (tx.note) {
			output += ' "' + tx.note + '"';
		}
		output += '\n';

		// postings
		for (let i = 0; i < tx.postings.length; i++) {
			const p = tx.postings[i];
			if (!p.account) continue;

			// indent
			output += '  ';
			output += p.account == null ? '' : p.account;
			if (p.amount) {
				output += '  ';
				output += p.amount == null ? '' : formatAmount(p.amount);
				output += ' ';
				output += p.currency == null ? '' : p.currency;
			}
			output += '\n';
		}

		return output;
	}

	/**
	 * Translates Xact into a ledger entry.
	 * @param {Xact} tx
	 * @returns {String} A ledger entry
	 */
	translateToLedger(tx: Xact) {
		let output = '';

		// transaction
		output += tx.date;
		output += ' ' + tx.payee;
		output += '\n';

		// note
		if (tx.note) {
			output += '    ; ' + tx.note + '\n';
		}

		// postings
		for (let i = 0; i < tx.postings.length; i++) {
			const p = tx.postings[i];
			if (!p.account) continue;

			output += '    ';
			output += p.account == null ? '' : p.account;
			if (p.amount) {
				output += '  ';
				output += p.amount == null ? '' : p.amount;
				output += ' ';
				output += p.currency == null ? '' : p.currency;
			}
			output += '\n';
		}

		return output;
	}

	/**
	 * Format a given value as a number with 2 decimals.
	 * @param {*} value
	 */
	formatNumber(value: number): string | null {
		// if (!value) return;
		if (value == null) return null;
		if (Number.isNaN(value)) return null;

		// make sure we have a number
		const result = Number(value);
		// let val = (value/1).toFixed(2).replace('.', ',')
		// return val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
		return result.toFixed(2);
	}

	async getDefaultCurrency(): Promise<string> {
		let defaultCurrency = get(DefaultCurrencyStore);
		if (!defaultCurrency) {
			defaultCurrency = await settings.get(SettingKeys.currency);
			DefaultCurrencyStore.set(defaultCurrency);
		}
		return defaultCurrency;
	}

	/**
	 * Get all the investment commodities. These are commodities used in inv. accounts.
	 */
	async getInvestmentCommodities(): Promise<string[]> {
		// get all investment accounts, iterate to get unique commodities?
		let commodities: string[] = [];

		const accounts = await loadInvestmentAccounts();
		await accounts.forEach((account) => {
			if (!account.balances) return;

			const accountCommodities = Object.keys(account.balances);
			commodities.push(...accountCommodities);
		});

		// keep only unique values
		commodities = [...new Set(commodities)];
		commodities.sort();

		return commodities;
	}

	/**
	 *
	 * @returns All Scheduled Xacts, serialized to JSON.
	 */
	async getScheduledXactsForExport(): Promise<string> {
		const records: ScheduledTransaction[] = await db.scheduled.toArray();
		const output = this.serialize(records);
		return output;
	}

	/**
	 * Deprecated. Now using importBalanceSheet instead.
	 * Imports accounts list from Ledger.
	 * @param accountsList Output of `ledger accounts`
	 * @returns
	 */
	async importAccounts(accountsList: string[]) {
		if (!accountsList) {
			throw new Error('The accounts list is required!');
		}

		const accounts = [];

		for (let i = 0; i < accountsList.length; i++) {
			const line = accountsList[i];
			if (line === '') continue;

			const account = new Account('');
			account.name = line;
			accounts.push(account);
		}

		return db.accounts.bulkPut(accounts);
	}

	/**
	 * Imports the accounts list with their balances.
	 * Populates the Account balances. Reads the balances from a Ledger report.
	 * 10,000 AUD  Assets:Bank Account
	 * @param lines Output of `ledger balance --flat`
	 * @returns The promise resolving to the id of the last record updated (Dexie default)
	 */
	async importBalanceSheet(ptaSystem: string, lines: string[]): Promise<unknown> {
		if (!lines || !lines.length) {
			throw new Error('No balance records received for import!');
		}

		const mainCurrency = await this.getDefaultCurrency();
		if (!mainCurrency) {
			throw new Error('No default currency set!');
		}

		const accountBalances: AccountIndex = {};

		// read and parse the balance sheet entries
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line === '') continue;

			// parse
			let account;
			if (ptaSystem === 'ledger') {
				account = LedgerParser.parseBalanceSheetRow(line);
			} else if (ptaSystem === 'beancount') {
				account = BeancountParser.parseBalanceSheetRow(line);
			}

			if (!account) {
				continue;
			} else {
				// see if we already have this account
				const existingAccount = accountBalances[account.name];
				if (existingAccount && existingAccount.balances && account.balances) {
					// add the new balance in another currency
					const currency = Object.keys(account.balances)[0];
					const amount = Object.values(account.balances)[0];
					existingAccount.balances[currency] = amount;
				} else {
					// insert account
					accountBalances[account.name] = account;
				}
			}
		}

		// the array of accounts to be updated.
		const accounts: Account[] = Object.values(accountBalances);
		return db.accounts.bulkPut(accounts);
	}

	importCommodities(text: string) {
		if (!text) {
			// todo: Notify.create({ message: 'No data to import.' })
			console.error('incomplete');
			return;
		}

		const commodities = [];
		const lines = text.split('\n');

		for (let i = 0; i < lines.length - 1; i++) {
			const commodity = lines[i].trim();
			commodities.push(commodity);
		}

		// todo: save

		return commodities;
	}

	/**
	 * Imports the payees into storage.
	 * @param payees Array of payee names from Ledger.
	 */
	async importPayees(payeeNames: string[]): Promise<void> {
		const payees = payeeNames.map((name) => new Payee(name));
		await db.payees.bulkAdd(payees);
	}

	/**
	 * Imports Scheduled Transactions from a JSON String backup (from the export file).
	 * @param {String} jsonList
	 */
	async importScheduledTransactions(jsonList: string) {
		if (!jsonList) {
			throw new Error('The transactions list is required!');
		}

		const parsed = JSON.parse(jsonList);
		// first delete all existing records?
		await db.scheduled.clear();

		await db.scheduled.bulkPut(parsed);
	}

	async loadAccount(name: string) {
		return db.accounts.get(name);
	}

	/**
	 * Loads all transactions for the given account name.
	 * Used to calculate the balance.
	 * @param {String} accountName
	 */
	async loadAccountTransactionsFor(accountName: string): Promise<Xact[]> {
		// get all the transactions which have postings that have this account.
		// const txIds: number[] = []

		let txs = await db.xacts
			.filter((tx: Xact) => tx.postings.some((posting: Posting) => posting.account == accountName))
			.toArray();

		// let postings = await transactions
		//   .map((tx) => tx.postings)
		//   // .map((p: Posting) => p)
		//   .flat()
		//   .filter((p: Posting) => p.account == accountName)

		txs = XactAugmenter.calculateEmptyPostingAmounts(txs);

		return txs;
	}

	// loadAssetClass(fullname: string) {
	//   return db.assetAllocation.get(fullname)
	// }

	/**
	 * Loads the favourite accounts.
	 * @returns {Array} List of Account records which are marked as Favourites.
	 */
	async loadFavouriteAccounts(): Promise<Account[]> {
		const favArray = await settings.get<string[]>(SettingKeys.favouriteAccounts);
		if (!favArray) {
			console.warn('No favourite accounts found.');
			return [];
		}

		// load account details
		const accounts: Account[] = await db.accounts.bulkGet(favArray);

		// Handle any accounts that have not been found.
		// Keep them in the list. They should be grayed out.
		for (let i = 0; i < accounts.length; i++) {
			let account = accounts[i];
			if (account === undefined) {
				// the account has been removed but the Favourites record exists.
				console.warn('Account marked as favourite but not found in Accounts.');

				account = new Account(favArray[i]);
				account.exists = false;
				accounts[i] = account;

				// accounts.splice(i, 1)
				// i--
			}
		}

		return accounts;
	}

	async loadScheduledXact(id: number): Promise<ScheduledTransaction> {
		const scx = await db.scheduled.get(id);
		if (!scx) {
			throw new Error('Scheduled transaction not found!');
		}

		ScheduledXact.set(scx);
		xact.set(scx.transaction);

		return scx;
	}

	/**
	 * Load single transaction with postings.
	 * @param {int} id Xact id
	 * @returns Xact with Postings
	 */
	async loadTransaction(id: number) {
		if (typeof id === 'string') {
			throw new Error('numeric ids are required as keys!');
		}

		const tx = await db.xacts.get(id);

		return tx;
	}

	saveAccount(account: Account) {
		return db.accounts.put(account);
	}

	/**
	 * Saves the given transaction as the Last Xact for the Payee.
	 * This is retrieved when the Payee is selected on a new transaction, or when editing.
	 * @param {Xact} tx
	 */
	async saveLastTransaction(tx: Xact) {
		const lastTx = new LastXact();
		lastTx.payee = tx.payee as string;
		lastTx.transaction = tx;

		// Delete unneeded properties - the ids, date, etc.
		this.clearIds(lastTx.transaction);

		// no need to remember the date
		delete lastTx.transaction.date;

		await this.db.lastXact.put(lastTx);

		return true;
	}

	serialize(content: unknown) {
		return JSON.stringify(content);
	}
}

export default new AppService();
