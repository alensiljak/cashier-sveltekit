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
   * @param {Transaction} tx The transaction object
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

    // validate Postings
    const postings = tx.postings
    // check whether the accounts exist!
    if (postings.length) {
      const accounts = await this.loadAccounts().toArray()
      const accountNames = accounts.map((account) => account.name)

      postings.forEach((posting) => {
        const account = posting.account
        if (!accountNames.includes(account)) {
          throw new Error(
            `The account ${account} does not exist! Please create first.`,
          )
        }
      })
    }

    // save all items in a transaction
    const id = await db.transaction('rw', db.transactions, async () => {
      // returns the transaction id
      const id = await db.transactions.put(tx)
      return id
    })
    return id as number
  }
}

export default CashierDAL
