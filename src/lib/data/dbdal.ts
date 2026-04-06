/**
 * Data Access Layer for permanent storage (indexeddb)
 */

import type { IndexableType } from 'dexie';
import { Account, Payee, ScheduledTransaction } from '$lib/data/model';
import db from '$lib/data/db';
import type { DAL } from './dal';

export default class CashierDAL implements DAL {

	static async create(): Promise<CashierDAL> {
		const dal = new CashierDAL();
		return dal;
	}

	async deletePayees() {
		return db.payees.clear();
	}

	async addPayees(payees: Payee[]): Promise<IndexableType> {
		return db.payees.bulkAdd(payees);
	}

	async getAccount(name: string): Promise<Account> {
		return await db.accounts.get(name);
	}

	/**
	 * @returns Collection
	 */
	loadAccounts() {
		return db.accounts.orderBy('name').toArray();
	}

	async loadPayees(): Promise<Payee[]> {
		return await db.payees.orderBy('name').toArray();
	}

	async saveAccount(account: Account): Promise<IndexableType> {
		return await db.accounts.put(account);
	}

	/**
	 * Save the transaction to the database.
	 * @param {Xact} tx The transaction object
	 * @returns the numeric id of the new transaction
	 */
	// async saveXact(tx: Xact): Promise<number> {
	// 	if (!tx) {
	// 		throw new Error('transaction object is invalid!', tx);
	// 	}
	// 	if (!tx.id) {
	// 		// create a new id for the transaction
	// 		tx.id = new Date().getTime();
	// 	}

	// 	// returns the transaction id
	// 	const id = await db.xacts.put(tx);
	// 	return id as number;
	// }
}

export async function saveScheduledTransaction(stx: ScheduledTransaction) {
	if (!stx.id) {
		stx.id = new Date().getTime();
	}

	// clear any transaction ids!
	if (stx.transaction && stx.transaction.id) {
		delete stx.transaction.id;
	}

	const result = await db.scheduled.put(stx);

	return result;
}
