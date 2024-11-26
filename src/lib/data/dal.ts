/**
 * Data Access Layer for permanent storage (indexeddb)
 */

import type { Collection, IndexableType } from 'dexie'
import { Account, Payee, ScheduledTransaction, Xact } from '$lib/data/model'
import db from '$lib/data/db'

class CashierDAL {
  async deletePayees() {
    return db.payees.clear()
  }

  async addPayees(payees: Payee[]): Promise<IndexableType> {
    return db.payees.bulkAdd(payees)
  }

  async getAccount(name: string): Promise<Account> {
    return await db.accounts.get(name)
  }

  /**
   * @returns Collection
   */
  loadAccounts() {
    return db.accounts.orderBy('name')
  }

  loadPayees(): Collection<Payee> {
    return db.payees.orderBy('name')
  }

  async saveScheduledTransaction(stx: ScheduledTransaction) {
    if (!stx.id) {
      stx.id = new Date().getTime()
      // console.log('new id generated:', this.scheduledTx.id)
    }

    const result = await db.scheduled.put(stx)
    //console.debug('saving schtx:', result)

    return result
  }

  async saveAccount(account: Account): Promise<IndexableType> {
    return await db.accounts.put(account)
  }

  /**
   * Save the transaction to the database.
   * @param {Xact} tx The transaction object
   * @returns the numeric id of the new transaction
   */
  async saveXact(tx: Xact): Promise<number> {
    if (!tx) {
      throw new Error('transaction object is invalid!', tx)
    }
    if (!tx.id) {
      // create a new id for the transaction
      tx.id = new Date().getTime()
    }

    // returns the transaction id
    const id = await db.xacts.put(tx)
    return id as number
  }
}

export default CashierDAL
