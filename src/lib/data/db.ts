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
	TrustedPeer,
	PeerSyncBaseline
} from '$lib/data/model';

// Define the schema

interface CashierDatabase extends Dexie {
	// accounts: Table;
	// payees: Table;
	scheduled: Table;
	settings: Table;
	deviceSettings: Table;
	peers: Table;
	peerSyncBaseline: Table;
	fsHandles: Table;
	// xacts: Table;
}

const db = new Dexie('Cashier') as CashierDatabase;

// Schema

db.version(1).stores({
	lastXact: 'payee',
	scheduled: '++id, nextDate',
	settings: 'key'
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

db.version(6).stores({
	scheduled: '++id, nextDate',
	settings: 'key',
	deviceSettings: 'key',
	peers: 'id',
	peerSyncBaseline: '[endpointId+path]'
});

db.version(7)
	.stores({
		scheduled: '++id, nextDate',
		settings: 'key',
		deviceSettings: 'key',
		peers: 'id',
		peerSyncBaseline: '[endpointId+path]',
		fsHandles: 'key'
	})
	.upgrade(async (tx) => {
		// Migrate from the separate cashier-fs-handles IndexedDB database
		const oldDbName = 'cashier-fs-handles';
		const oldStoreName = 'handles';

		const migrationPromise = new Promise<void>((resolve, reject) => {
			const req = indexedDB.open(oldDbName);
			req.onupgradeneeded = () => {};
			req.onsuccess = () => {
				const oldDb = req.result;
				const txOld = oldDb.transaction(oldStoreName, 'readonly');
				const store = txOld.objectStore(oldStoreName);
				const getAllReq = store.getAll();

				getAllReq.onsuccess = async () => {
					const allHandles = getAllReq.result;
					for (const handle of allHandles) {
						const key = handle.key;
						const value = handle.value;
						if (key !== undefined && value !== undefined) {
							await tx.table('fsHandles').put(value, key);
						}
					}
					oldDb.close();
					resolve();
				};
				getAllReq.onerror = () => {
					oldDb.close();
					reject(getAllReq.error);
				};
			};
			req.onerror = () => reject(req.error);
		});

		return migrationPromise;
	});

// Mappings

db.settings.mapToClass(Setting);
db.deviceSettings.mapToClass(Setting);
db.scheduled.mapToClass(ScheduledTransaction);
db.peers.mapToClass(TrustedPeer);
db.peerSyncBaseline.mapToClass(PeerSyncBaseline);

export default db;
