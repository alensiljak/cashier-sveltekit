/*
    One fixed sample file per released backup format (tests/data/backup/), restored
    into an empty device. All data in them is made up.

    Never regenerate or edit a sample: it stands for files people already have. v1.json
    was written by the last release of format 1 (the code before commit 23bfd8b2), v2.json
    by format 2.
*/
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));
vi.mock('#lib/sync/ydocDevices', async (orig) => ({
	...(await orig<typeof import('#lib/sync/ydocDevices')>()),
	getDeviceId: vi.fn(async () => 'this-device')
}));

import db from '#lib/data/db';
import { CrdtScxStore } from '#lib/storage/crdtScxStore';
import { CrdtXactStore } from '#lib/storage/crdtXactStore';
import { setScxStore } from '#lib/storage/scxStoreRegistry';
import { setXactStore } from '#lib/storage/xactStoreRegistry';
import { inspectBackup, restoreBackup } from '#lib/services/backup';

const sample = (name: string) => readFileSync(`tests/data/backup/${name}.json`, 'utf8');

const PASSPHRASE = 'sample backup passphrase';

let counter = 0;
let scxStore: CrdtScxStore;
let xactStore: CrdtXactStore;

beforeEach(async () => {
	counter++;
	scxStore = new CrdtScxStore(`sample-scx-${counter}`);
	setScxStore(scxStore);
	xactStore = new CrdtXactStore(`sample-xacts-${counter}`, async () => 'this-device');
	setXactStore(xactStore);
	await xactStore.initialize();
	await Promise.all(
		[db.settings, db.deviceSettings, db.peers, db.revocations].map((table) => table.clear())
	);
});

/** A stored table as `{ key: parsed value }`. */
async function stored(table: typeof db.settings): Promise<Record<string, unknown>> {
	const rows = (await table.toArray()) as { key: string; value: string }[];
	return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
}

const shared = (webdavPassword: string) => ({
	currency: 'EUR',
	'importer.ibkr': { cashAccount: 'Assets:IB:Cash-{currency}' },
	'webdav-settings': {
		url: 'https://dav.example.com',
		username: 'alice',
		password: webdavPassword
	}
});

const payees = async () => (await scxStore.list()).map((s) => s.transaction?.payee);

describe('version 1 sample', () => {
	it('is described', () => {
		expect(inspectBackup(sample('v1'))).toEqual({
			version: 1,
			sections: ['settings', 'scx'],
			hasSecrets: false,
			scxIsList: true,
			counts: { settings: 3, peers: 0 }
		});
	});

	it('restores', async () => {
		const result = await restoreBackup(sample('v1'));

		expect(result).toEqual({ restored: ['settings', 'scx'], secrets: 'none', missing: [] });
		expect(await stored(db.settings)).toEqual(shared(''));
		expect(await payees()).toEqual(['Sample Rent', 'Sample Gym']);
		// Only the (empty) list of fields to fill in.
		expect(await stored(db.deviceSettings)).toEqual({ restoreMissing: [] });
	});
});

describe('version 2 sample', () => {
	const device = (secret: (value: string) => string) => ({
		homeCardNames: ['favourites', 'forecast'],
		importBookDirectory: 'sample-books',
		'notifications.time': '08:30',
		peerIceServers: [
			{ urls: 'stun:stun.example.com' },
			{
				urls: 'turn:turn.example.com',
				username: secret('sample-turn'),
				credential: secret('sample-credential')
			}
		],
		peerName: 'Sample phone',
		's3-settings': {
			endpoint: 'https://s3.example.com',
			region: 'auto',
			bucket: 'sample-bucket',
			prefix: 'cashier',
			accessKeyId: secret('sample-access-key'),
			secretAccessKey: secret('sample-secret-key'),
			passphrase: secret('sample-s3-passphrase')
		},
		'webdav-encryption': { enabled: true, passphrase: secret('sample-dav-passphrase') }
	});
	const bookkeeping = ['previousDeviceId', 'previousDeviceHeld', 'restoreMissing'];
	const storedDevice = async () =>
		Object.fromEntries(
			Object.entries(await stored(db.deviceSettings)).filter(([k]) => !bookkeeping.includes(k))
		);

	async function expectOtherData() {
		expect(await payees()).toEqual(['Sample Rent', 'Sample Gym']);
		expect((await xactStore.list()).map((s) => s.xact.payee)).toEqual(['Sample Grocer']);
		expect(await db.peers.toArray()).toEqual(JSON.parse(sample('v2')).peers.peers);
		expect(await db.revocations.toArray()).toEqual(JSON.parse(sample('v2')).peers.revocations);
	}

	it('is described', () => {
		expect(inspectBackup(sample('v2'))).toEqual({
			version: 2,
			sections: ['settings', 'scx', 'workingSet', 'device', 'peers'],
			hasSecrets: true,
			scxIsList: true,
			counts: { settings: 3, peers: 1 }
		});
	});

	it('restores with the credentials', async () => {
		const result = await restoreBackup(sample('v2'), { secretsPassphrase: PASSPHRASE });

		expect(result).toEqual({
			restored: ['settings', 'scx', 'workingSet', 'device', 'peers'],
			secrets: 'restored',
			missing: [],
			predecessor: 'sample-old-device'
		});
		expect(await stored(db.settings)).toEqual(shared('sample-dav-password'));
		expect(await storedDevice()).toEqual(device((value) => value));
		await expectOtherData();
	});

	it('restores without the credentials', async () => {
		const result = await restoreBackup(sample('v2'));

		expect(result.secrets).toBe('skipped');
		expect(result.missing).toEqual([
			'webdav.password',
			's3.accessKeyId',
			's3.secretAccessKey',
			's3.passphrase',
			'webdavEncryption.passphrase'
		]);
		expect(await stored(db.settings)).toEqual(shared(''));
		expect(await storedDevice()).toEqual(device(() => ''));
		await expectOtherData();
	});
});
