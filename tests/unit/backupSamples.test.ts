/*
    One fixed sample file per released backup format (tests/data/backup/), restored
    into an empty device. All data in them is made up.

    Never regenerate or edit a sample: it stands for files people already have. v1.json
    was written by the last release of format 1 (the code before commit 23bfd8b2), v2.json
    by format 2, and v3.json.gz by format 3 when it was completed.
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
import { decodeBackup, inspectBackup, restoreBackup } from '#lib/services/backup';

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
			credentials: [],
			scxIsList: true,
			counts: { settings: 3, peers: 0 }
		});
	});

	it('restores', async () => {
		const result = await restoreBackup(sample('v1'));

		expect(result).toEqual({
			restored: ['settings', 'scx'],
			secrets: 'none',
			missing: [],
			stores: { scx: { added: 2, changed: 0, deleted: 0 } }
		});
		expect(await stored(db.settings)).toEqual(shared(''));
		expect(await payees()).toEqual(['Sample Rent', 'Sample Gym']);
		// Only the (empty) list of fields to fill in.
		expect(await stored(db.deviceSettings)).toEqual({ restoreMissing: [] });
	});
});

describe('version 2 sample', () => {
	const device = (secret: (value: string) => string) => ({
		homeCardNames: ['favourites', 'forecast'],
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
		const [{ fileSyncInitializedAt: _, ...peer }] = JSON.parse(sample('v2')).peers.peers;
		expect(await db.peers.toArray()).toEqual([peer]);
		expect(await db.revocations.toArray()).toEqual(JSON.parse(sample('v2')).peers.revocations);
	}

	it('is described', () => {
		expect(inspectBackup(sample('v2'))).toEqual({
			version: 2,
			sections: ['settings', 'workingSet', 'scx', 'device', 'credentials'],
			hasSecrets: true,
			credentials: [],
			scxIsList: true,
			counts: { settings: 3, peers: 1 }
		});
	});

	it('restores with the credentials', async () => {
		const result = await restoreBackup(sample('v2'), { secretsPassphrase: PASSPHRASE });

		expect(result).toEqual({
			restored: ['settings', 'workingSet', 'scx', 'device', 'credentials'],
			secrets: 'restored',
			missing: [],
			stores: {
				scx: { added: 2, changed: 0, deleted: 0 },
				workingSet: { added: 1, changed: 0, deleted: 0 }
			},
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

describe('version 3 sample', () => {
	const CREDENTIALS = [
		'webdav',
		's3',
		'webdavEncryption',
		'ice',
		'proxy',
		'mistral',
		'aware',
		'scalable',
		'enableBanking',
		'enableBankingSessions'
	];
	const read = () => decodeBackup(new Uint8Array(readFileSync('tests/data/backup/v3.json.gz')));

	it('is compressed and described', async () => {
		const { content, compressed } = await read();

		expect(compressed).toBe(true);
		expect(inspectBackup(content)).toEqual({
			version: 3,
			sections: ['settings', 'workingSet', 'scx', 'device', 'credentials'],
			hasSecrets: true,
			credentials: CREDENTIALS,
			scxIsList: false,
			counts: { settings: 3, peers: 1 }
		});
	});

	it('restores with the credentials', async () => {
		const result = await restoreBackup((await read()).content, { secretsPassphrase: PASSPHRASE });

		expect(result.secrets).toBe('restored');
		expect(result.missing).toEqual([]);
		expect(result.stores).toEqual({
			scx: { added: 2, changed: 0, deleted: 0 },
			workingSet: { added: 1, changed: 0, deleted: 0 }
		});
		expect(await stored(db.settings)).toEqual(shared('sample-dav-password'));
		expect(await stored(db.deviceSettings)).toMatchObject({
			peerName: 'Sample phone',
			proxy: { url: 'https://proxy.example.com/api/proxy', key: 'sample-proxy-key' },
			's3-settings': { bucket: 'sample-bucket', secretAccessKey: 'sample-secret-key' },
			'speech.engine': 'mistral',
			'speech.language': 'de-DE',
			'speech.voice-mode': true,
			'speech.mistral.model': 'voxtral-mini-latest',
			'speech.mistral.api-key': 'sample-mistral-key',
			'prices.aware.api-key': 'sample-aware-key',
			'sync.stale-days': 14,
			'importer.scalable.tokens': { accessToken: 'sample-token' },
			'importer.enablebanking.credentials': { privateKeyPem: 'sample-pem' },
			'importer.enablebanking.sessions': [{ sessionId: 'sample-session' }]
		});
		expect(await payees()).toEqual(['Sample Rent', 'Sample Gym']);
		expect(await db.peers.count()).toBe(1);
	});

	it('restores without the credentials', async () => {
		const result = await restoreBackup((await read()).content);

		expect(result.secrets).toBe('skipped');
		expect(result.missing).toHaveLength(5);
		const device = await stored(db.deviceSettings);
		expect(device.proxy).toEqual({ url: 'https://proxy.example.com/api/proxy', key: '' });
		expect(device).not.toHaveProperty(['speech.mistral.api-key']);
		expect(device).not.toHaveProperty(['importer.scalable.tokens']);
	});
});
