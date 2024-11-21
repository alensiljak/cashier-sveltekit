/*
    Data access layer, using Dexie.
*/
import Dexie, { type Table } from 'dexie'
import {
    Account,
    LastTransaction,
    Transaction,
    Payee,
    Posting,
    ScheduledTransaction,
    Setting,
} from '../model'
  import { AssetClass } from '$lib/AssetClass'

// Define the schema

interface CashierDatabase extends Dexie {
    accounts: Table
    assetAllocation: Table
    lastTransaction: Table
    payees: Table
    scheduled: Table
    settings: Table
    transactions: Table
}

const db = new Dexie('Cashier') as CashierDatabase

// Schema

db.version(1).stores({
    accounts: 'name',
    assetAllocation: 'fullname',
    lastTransaction: 'payee',
    payees: 'name',
    scheduled: '++id, nextDate',
    settings: 'key',
    transactions: '++id, date',
})

// Mappings

db.accounts.mapToClass(Account)
db.assetAllocation.mapToClass(AssetClass)
db.lastTransaction.mapToClass(LastTransaction)
db.payees.mapToClass(Payee)
db.transactions.mapToClass(Transaction)
db.settings.mapToClass(Setting)
db.scheduled.mapToClass(ScheduledTransaction)

export default db
