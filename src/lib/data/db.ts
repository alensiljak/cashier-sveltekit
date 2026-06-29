/*
    Data access layer, using Dexie.
*/
import Dexie, { type Table } from 'dexie';
import {
	// Account,
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
	// payees: Table;
	scheduled: Table;
	settings: Table;
	deviceSettings: Table;
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

db.version(3).stores({
	lastXact: null,
	scheduled: '++id, nextDate',
	settings: 'key',
	peers: 'id'
});

// Keys that moved from settings → deviceSettings in v4 (mirrors DeviceSettingKeys values)
const DEVICE_KEYS_V4 = [
	'peerId',
	'peerName',
	'importBookDirectory',
	'importBookFileSpec',
	'ledgerCacheEnabled',
	'ledger.metaSnapshot'
];

// Keys that moved back from deviceSettings → settings in v5
const USER_KEYS_V5 = ['importBookFileSpec'];

db.version(4)
	.stores({
		scheduled: '++id, nextDate',
		settings: 'key',
		deviceSettings: 'key',
		peers: 'id'
	})
	.upgrade(async (tx) => {
		for (const key of DEVICE_KEYS_V4) {
			const record = await tx.table('settings').get(key);
			if (record) {
				await tx.table('deviceSettings').put(record);
				await tx.table('settings').delete(key);
			}
		}
	});

db.version(5)
	.stores({
		scheduled: '++id, nextDate',
		settings: 'key',
		deviceSettings: 'key',
		peers: 'id'
	})
	.upgrade(async (tx) => {
		for (const key of USER_KEYS_V5) {
			const record = await tx.table('deviceSettings').get(key);
			if (record) {
				await tx.table('settings').put(record);
				await tx.table('deviceSettings').delete(key);
			}
		}
	});

// Mappings

// db.accounts.mapToClass(Account);
// db.payees.mapToClass(Payee);
// db.xacts.mapToClass(Xact);
db.settings.mapToClass(Setting);
db.deviceSettings.mapToClass(Setting);
db.scheduled.mapToClass(ScheduledTransaction);
db.peers.mapToClass(TrustedPeer);

export default db;
