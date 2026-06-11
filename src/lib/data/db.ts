/*
    Data access layer, using Dexie.
*/
import Dexie, { type Table } from 'dexie';
import {
	// Account,
	LastXact,
	// Xact,
	// Payee,
	// Posting,
	ScheduledTransaction,
	Setting,
	TrustedPeer
} from '$lib/data/model';

// Define the schema

interface CashierDatabase extends Dexie {
	// accounts: Table;
	lastXact: Table;
	// payees: Table;
	scheduled: Table;
	settings: Table;
	peers: Table;
	// xacts: Table;
}

const db = new Dexie('Cashier') as CashierDatabase;

// Schema

db.version(1).stores({
	// accounts: 'name',
	lastXact: 'payee',
	// payees: 'name',
	scheduled: '++id, nextDate',
	settings: 'key'
	// xacts: '++id, date'
});

db.version(2).stores({
	lastXact: 'payee',
	scheduled: '++id, nextDate',
	settings: 'key',
	peers: 'id'
});

// Mappings

// db.accounts.mapToClass(Account);
db.lastXact.mapToClass(LastXact);
// db.payees.mapToClass(Payee);
// db.xacts.mapToClass(Xact);
db.settings.mapToClass(Setting);
db.scheduled.mapToClass(ScheduledTransaction);
db.peers.mapToClass(TrustedPeer);

export default db;
