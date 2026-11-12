/*
    Backup/restore of settings and scheduled transactions (JSON file), against
    fake IndexedDB. The important properties: a backup restores what it saved,
    and a bad file never destroys existing data.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));
vi.mock('#lib/sync/ydocDevices', async (orig) => ({
	...(await orig<typeof import('#lib/sync/ydocDevices')>()),
	getDeviceId: vi.fn(async () => 'this-device')
}));

import db from '#lib/data/db';
import { Setting } from '#lib/data/model';
import { DeviceSettingKeys, deviceSettings, SettingKeys } from '#lib/settings';
import appService from '#lib/services/appService';
import { CrdtScxStore } from '#lib/storage/crdtScxStore';
import { setScxStore } from '#lib/storage/scxStoreRegistry';
import { setXactStore } from '#lib/storage/xactStoreRegistry';
import {
	BACKUP_VERSION,
	createBackup,
	createBackupFile,
	getBackupFilename,
	inspectBackup,
	restoreBackup,
	type BackupOptions
} from '#lib/services/backupService';
import { getRestoreMissing } from '#lib/services/restoreMissing';
import { getRestoredDevice } from '#lib/services/restoredDevice';

/** The part of a backup the tests below inspect in isolation: no working set, no device. */
const basic: BackupOptions = { sections: ['settings', 'scx'] };

const scx = (payee: string, nextDate = '2026-01-01') => ({
	nextDate,
	period: 'months',
	count: 1,
	endDate: null,
	transaction: { date: nextDate, payee, postings: [], meta: {} }
});

let scxCounter = 0;
let scxStore: CrdtScxStore;

async function seed() {
	// A fresh store per test, so tests never share records.
	scxStore = new CrdtScxStore(`backup-test-${scxCounter++}`);
	setScxStore(scxStore);
	await db.settings.clear();
	await db.settings.bulkAdd([new Setting('currency', '"EUR"'), new Setting('theme', '"dark"')]);
	await scxStore.addMany([scx('Rent'), scx('Gym', '2026-02-01')]);
}

const payees = async () => (await scxStore.list()).map((s) => s.transaction?.payee);

beforeEach(seed);
afterEach(() => vi.restoreAllMocks());

describe('getBackupFilename', () => {
	it('embeds the date and time', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 7, 15, 9, 5, 7));

		expect(getBackupFilename()).toBe('cashier-backup_2026-08-15_090507.json');

		vi.useRealTimers();
	});
});

describe('createBackup', () => {
	it('serializes settings and scheduled transactions', async () => {
		const backup = JSON.parse(await createBackup(basic));

		expect(backup.version).toBe(BACKUP_VERSION);
		expect(backup.settings).toEqual([
			{ key: 'currency', value: '"EUR"' },
			{ key: 'theme', value: '"dark"' }
		]);
		expect(backup.scx.map((s: { transaction: { payee: string } }) => s.transaction.payee)).toEqual([
			'Rent',
			'Gym'
		]);
	});

	it('produces an empty but valid backup for an empty database', async () => {
		await db.settings.clear();
		await scxStore.clear();

		expect(JSON.parse(await createBackup(basic))).toEqual({
			version: BACKUP_VERSION,
			settings: [],
			scx: []
		});
	});

	it('holds only the chosen sections', async () => {
		const backup = JSON.parse(await createBackup({ sections: ['scx'] }));

		expect(Object.keys(backup).sort()).toEqual(['scx', 'version']);
	});
});

describe('restoreBackup', () => {
	it('round-trips: restoring a backup brings back exactly what it saved', async () => {
		const backup = await createBackup(basic);
		await db.settings.clear();
		await scxStore.clear();
		await db.settings.put(new Setting('other', '"x"'));

		await restoreBackup(backup);

		expect((await db.settings.toArray()).map((s: Setting) => s.key)).toEqual(['currency', 'theme']);
		expect(await payees()).toEqual(['Rent', 'Gym']);
		expect(await createBackup(basic)).toBe(backup);
	});

	it('restores a version 1 file (settings and scheduled transactions only)', async () => {
		const result = await restoreBackup(
			JSON.stringify({ settings: [new Setting('a', '1')], scx: [scx('Old')] })
		);

		expect(result.restored).toEqual(['settings', 'scx']);
		expect(await payees()).toEqual(['Old']);
	});

	it('restores only the sections asked for', async () => {
		const backup = await createBackup(basic);
		await db.settings.clear();
		await scxStore.clear();

		await restoreBackup(backup, { sections: ['scx'] });

		expect(await db.settings.count()).toBe(0);
		expect(await payees()).toEqual(['Rent', 'Gym']);
	});

	it('replaces existing records rather than merging', async () => {
		await restoreBackup(JSON.stringify({ settings: [new Setting('a', '1')], scx: [scx('Only')] }));

		expect((await db.settings.toArray()).map((s: Setting) => s.key)).toEqual(['a']);
		expect(await payees()).toEqual(['Only']);
	});

	it.each([
		['not JSON', 'this is not json'],
		['JSON null', 'null'],
		['a JSON array', '[]'],
		['missing scx', JSON.stringify({ settings: [] })],
		['missing settings', JSON.stringify({ scx: [] })],
		['wrong types', JSON.stringify({ settings: {}, scx: 'x' })],
		['a newer format', JSON.stringify({ version: BACKUP_VERSION + 1, settings: [] })],
		['version 2 without sections', JSON.stringify({ version: 2 })],
		['a damaged section', JSON.stringify({ version: 2, peers: { peers: 'x', revocations: [] } })],
		['a damaged credentials block', JSON.stringify({ version: 2, settings: [], secrets: { v: 1 } })]
	])('rejects %s and keeps the existing data', async (_name, content) => {
		await expect(restoreBackup(content)).rejects.toThrow();

		expect((await db.settings.toArray()).map((s: Setting) => s.key)).toEqual(['currency', 'theme']);
		expect(await payees()).toEqual(['Rent', 'Gym']);
	});

	it('rolls everything back when a write fails part-way', async () => {
		// Duplicate setting keys make bulkAdd fail after the tables were cleared.
		const duplicate = JSON.stringify({
			settings: [new Setting('dup', '1'), new Setting('dup', '2')],
			scx: [scx('New')]
		});

		await expect(restoreBackup(duplicate)).rejects.toThrow();

		expect((await db.settings.toArray()).map((s: Setting) => s.key)).toEqual(['currency', 'theme']);
		expect(await payees()).toEqual(['Rent', 'Gym']);
	});
});

describe('WebDAV password', () => {
	const webdav = (password: string, overrides: Record<string, string> = {}) =>
		new Setting(
			SettingKeys.webdavSettings,
			JSON.stringify({ url: 'https://dav.example.com', username: 'alice', password, ...overrides })
		);
	const stored = async () =>
		JSON.parse((await db.settings.get(SettingKeys.webdavSettings)).value) as Record<string, string>;

	beforeEach(async () => {
		await db.settings.put(webdav('s3cret'));
	});

	it('is left out of the backup, keeping the rest of the WebDAV settings', async () => {
		const text = await createBackup(basic);

		expect(text).not.toContain('s3cret');
		const entry = JSON.parse(text).settings.find(
			(s: Setting) => s.key === SettingKeys.webdavSettings
		);
		expect(JSON.parse(entry.value)).toEqual({
			url: 'https://dav.example.com',
			username: 'alice',
			password: ''
		});
	});

	it('does not change the stored setting when a backup is made', async () => {
		await createBackup(basic);

		expect((await stored()).password).toBe('s3cret');
	});

	it('is kept on this device when restoring a backup for the same server and user', async () => {
		const backup = await createBackup(basic);

		await restoreBackup(backup);

		expect(await stored()).toMatchObject({ username: 'alice', password: 's3cret' });
	});

	it('is not carried over to a different server or user', async () => {
		const other = JSON.stringify({
			settings: [webdav('', { url: 'https://other.example.com' })],
			scx: []
		});

		await restoreBackup(other);

		expect((await stored()).password).toBe('');
	});

	it('is left blank on a device that has no password yet', async () => {
		const backup = await createBackup(basic);
		await db.settings.clear();

		await restoreBackup(backup);

		expect((await stored()).password).toBe('');
	});

	it('an explicit password in a backup file is restored as written', async () => {
		await restoreBackup(JSON.stringify({ settings: [webdav('from-file')], scx: [] }));

		expect((await stored()).password).toBe('from-file');
	});

	it('tolerates a WebDAV setting that is not valid JSON', async () => {
		await db.settings.put(new Setting(SettingKeys.webdavSettings, 'not json'));

		expect(JSON.parse(await createBackup(basic)).settings.map((s: Setting) => s.value)).toContain(
			'not json'
		);
	});
});

describe('createBackupFile', () => {
	it('downloads the backup under the given file name', async () => {
		const createObjectURL = vi.fn(() => 'blob:fake');
		const revokeObjectURL = vi.fn();
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
		const clicked: { href: string; download: string }[] = [];
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
			this: HTMLAnchorElement
		) {
			clicked.push({ href: this.href, download: this.download });
		});

		await createBackupFile('my-backup.json', basic);

		expect(clicked).toEqual([{ href: 'blob:fake', download: 'my-backup.json' }]);
		const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
		expect(JSON.parse(await blob.text()).settings).toHaveLength(2);
		expect(document.querySelector('a[download]')).toBeNull();
		vi.unstubAllGlobals();
	});
});

describe('appService.importScheduledTransactions', () => {
	it('replaces the scheduled transactions', async () => {
		await appService.importScheduledTransactions(JSON.stringify([scx('Imported')]));

		expect(await payees()).toEqual(['Imported']);
	});

	it('requires content and a JSON array, keeping existing data otherwise', async () => {
		await expect(appService.importScheduledTransactions('')).rejects.toThrow('required');
		await expect(appService.importScheduledTransactions('{"a":1}')).rejects.toThrow('array');
		await expect(appService.importScheduledTransactions('nope')).rejects.toThrow();

		expect(await payees()).toEqual(['Rent', 'Gym']);
	});
});

const PASSPHRASE = 'correct horse battery staple';
const sync = ['settings', 'device'] as const;

const s3 = {
	endpoint: 'https://s3.example.com',
	region: 'auto',
	bucket: 'books',
	prefix: '',
	accessKeyId: 'AKIAEXAMPLE',
	secretAccessKey: 'sekrit-key',
	passphrase: 'bucket-passphrase'
};

async function seedCredentials() {
	await deviceSettings.set(DeviceSettingKeys.s3Settings, s3);
	await deviceSettings.set(DeviceSettingKeys.webdavEncryption, {
		enabled: true,
		passphrase: 'dav-passphrase'
	});
	await deviceSettings.set(DeviceSettingKeys.peerName, 'Phone');
	await db.settings.put(
		new Setting(
			SettingKeys.webdavSettings,
			JSON.stringify({ url: 'https://dav.example.com', username: 'alice', password: 'dav-pass' })
		)
	);
}

const s3Stored = async () => (await deviceSettings.get<typeof s3>(DeviceSettingKeys.s3Settings))!;

/** Simulates a clean device: nothing stored. */
async function wipe() {
	await db.settings.clear();
	await db.deviceSettings.clear();
	await db.peers.clear();
	await db.revocations.clear();
}

describe('credentials', () => {
	beforeEach(async () => {
		await db.deviceSettings.clear();
		await seedCredentials();
	});

	it('are left out of the file unless a passphrase is given', async () => {
		const text = await createBackup({ sections: [...sync] });

		for (const secret of [
			'AKIAEXAMPLE',
			'sekrit-key',
			'bucket-passphrase',
			'dav-passphrase',
			'dav-pass'
		]) {
			expect(text).not.toContain(secret);
		}
		const backup = JSON.parse(text);
		expect(backup.secrets).toBeUndefined();
		// Everything else of those settings is in.
		const stored = JSON.parse(
			backup.device.settings.find((x: Setting) => x.key === DeviceSettingKeys.s3Settings).value
		);
		expect(stored).toEqual({ ...s3, accessKeyId: '', secretAccessKey: '', passphrase: '' });
		expect(backup.withheld.sort()).toEqual(
			[
				's3.accessKeyId',
				's3.secretAccessKey',
				's3.passphrase',
				'webdav.password',
				'webdavEncryption.passphrase'
			].sort()
		);
	});

	it('are encrypted in the file when a passphrase is given', async () => {
		const text = await createBackup({ sections: [...sync], secretsPassphrase: PASSPHRASE });

		for (const secret of ['AKIAEXAMPLE', 'sekrit-key', 'bucket-passphrase', 'dav-pass']) {
			expect(text).not.toContain(secret);
		}
		expect(JSON.parse(text).secrets).toMatchObject({ v: 1 });
	});

	it('come back with the right passphrase', async () => {
		const text = await createBackup({ sections: [...sync], secretsPassphrase: PASSPHRASE });
		await wipe();

		const result = await restoreBackup(text, { secretsPassphrase: PASSPHRASE });

		expect(result.secrets).toBe('restored');
		expect(result.missing).toEqual([]);
		expect(await s3Stored()).toEqual(s3);
		expect(await deviceSettings.get(DeviceSettingKeys.webdavEncryption)).toEqual({
			enabled: true,
			passphrase: 'dav-passphrase'
		});
		expect(await settings_get(SettingKeys.webdavSettings)).toMatchObject({ password: 'dav-pass' });
	});

	it('restore everything else, and say so, with the wrong passphrase', async () => {
		const text = await createBackup({ sections: [...sync], secretsPassphrase: PASSPHRASE });
		await wipe();

		const result = await restoreBackup(text, { secretsPassphrase: 'not the passphrase' });

		expect(result.secrets).toBe('wrong-passphrase');
		expect(await s3Stored()).toEqual({
			...s3,
			accessKeyId: '',
			secretAccessKey: '',
			passphrase: ''
		});
		expect(await deviceSettings.get(DeviceSettingKeys.peerName)).toBe('Phone');
		expect(result.missing).toHaveLength(5);
	});

	it('are reported as missing when the file has none, for the pages to ask for', async () => {
		const text = await createBackup({ sections: [...sync] });
		await wipe();

		const result = await restoreBackup(text);

		expect(result.secrets).toBe('none');
		expect([...result.missing].sort()).toEqual(
			[
				's3.accessKeyId',
				's3.secretAccessKey',
				's3.passphrase',
				'webdav.password',
				'webdavEncryption.passphrase'
			].sort()
		);
		expect((await getRestoreMissing()).sort()).toEqual([...result.missing].sort());
	});

	it('are skipped when a file with credentials is restored without a passphrase', async () => {
		const text = await createBackup({ sections: [...sync], secretsPassphrase: PASSPHRASE });
		await wipe();

		expect((await restoreBackup(text)).secrets).toBe('skipped');
	});

	it('already on this device are kept for the same bucket, not for another', async () => {
		const text = await createBackup({ sections: [...sync] });

		await restoreBackup(text);
		expect(await s3Stored()).toEqual(s3);
		expect((await getRestoreMissing()).filter((id) => id.startsWith('s3.'))).toEqual([]);

		await deviceSettings.set(DeviceSettingKeys.s3Settings, { ...s3, bucket: 'other' });
		await restoreBackup(text);
		expect(await s3Stored()).toMatchObject({ bucket: 'books', secretAccessKey: '' });
	});

	it('need a long enough passphrase', async () => {
		await expect(createBackup({ sections: [...sync], secretsPassphrase: 'short' })).rejects.toThrow(
			'at least'
		);
	});
});

async function settings_get(key: string) {
	const row = await db.settings.get(key);
	return row ? JSON.parse(row.value) : null;
}

describe('device section', () => {
	beforeEach(async () => {
		await db.deviceSettings.clear();
		await deviceSettings.set(DeviceSettingKeys.peerName, 'Phone');
		await deviceSettings.set(DeviceSettingKeys.visibleCards, ['a', 'b']);
		// Tied to this device or to its sync progress: never in the file.
		await deviceSettings.set(DeviceSettingKeys.peerId, 'this-device');
		await deviceSettings.set(DeviceSettingKeys.deltaSyncState, { x: 1 });
		await deviceSettings.set(DeviceSettingKeys.syncGroupSecret, 'group-secret');
	});

	it('holds the portable settings and the device ID only', async () => {
		const backup = JSON.parse(await createBackup({ sections: ['device'] }));

		expect(backup.device.id).toBe('this-device');
		expect(backup.device.settings.map((s: Setting) => s.key).sort()).toEqual(
			[DeviceSettingKeys.peerName, DeviceSettingKeys.visibleCards].sort()
		);
		expect(JSON.stringify(backup)).not.toContain('group-secret');
	});

	it('keeps the device it was made on as the previous device, held until a person decides', async () => {
		const text = await createBackup({ sections: ['device'] });
		await db.deviceSettings.clear();
		const { getDeviceId } = await import('#lib/sync/ydocDevices');
		vi.mocked(getDeviceId).mockResolvedValue('new-device');

		const result = await restoreBackup(text);

		expect(result.predecessor).toBe('this-device');
		expect(await deviceSettings.get(DeviceSettingKeys.previousDeviceId)).toBe('this-device');
		expect(await getRestoredDevice()).toEqual({ id: 'this-device' });
		expect(await deviceSettings.get(DeviceSettingKeys.peerName)).toBe('Phone');
		vi.mocked(getDeviceId).mockResolvedValue('this-device');
	});

	it('restoring on the same device sets no previous device', async () => {
		const text = await createBackup({ sections: ['device'] });

		const result = await restoreBackup(text);

		expect(result.predecessor).toBeUndefined();
		expect(await getRestoredDevice()).toBeNull();
	});

	it('does not touch the settings that stay with this device', async () => {
		const text = await createBackup({ sections: ['device'] });
		await deviceSettings.set(DeviceSettingKeys.deltaSyncState, { x: 2 });

		await restoreBackup(text);

		expect(await deviceSettings.get(DeviceSettingKeys.deltaSyncState)).toEqual({ x: 2 });
		expect(await deviceSettings.get(DeviceSettingKeys.peerId)).toBe('this-device');
	});
});

describe('trusted devices', () => {
	const peer = (id: string, extra: Record<string, unknown> = {}) => ({
		id,
		name: `Device ${id}`,
		trustedAt: '2026-01-01T00:00:00.000Z',
		publicKey: `key-${id}`,
		...extra
	});
	const eviction = (id: string, status: 'evicted' | 'readmitted' = 'evicted') => ({
		id,
		status,
		record: {},
		name: '',
		fingerprint: '',
		byName: '',
		receivedAt: '2026-01-02T00:00:00.000Z',
		seen: false
	});

	beforeEach(async () => {
		await db.peers.clear();
		await db.revocations.clear();
	});

	it('are added on restore, and what is there is not overwritten', async () => {
		await db.peers.bulkAdd([peer('a'), peer('b')] as never);
		const text = await createBackup({ sections: ['peers'] });
		await db.peers.clear();
		await db.peers.add(peer('a', { name: 'Renamed here', readOnly: true }) as never);

		await restoreBackup(text);

		expect((await db.peers.toArray()).map((p) => p.id).sort()).toEqual(['a', 'b']);
		expect((await db.peers.get('a'))!.name).toBe('Renamed here');
	});

	it('do not bring back a device that was evicted, here or in the backup', async () => {
		await db.peers.bulkAdd([peer('a'), peer('b'), peer('c', { legacyIds: ['c-old'] })] as never);
		await db.revocations.add(eviction('b') as never);
		const text = await createBackup({ sections: ['peers'] });
		await db.peers.clear();
		await db.revocations.clear();
		await db.revocations.add(eviction('c-old') as never);

		await restoreBackup(text);

		expect((await db.peers.toArray()).map((p) => p.id)).toEqual(['a']);
		// The tombstone from the backup is kept too, so the device cannot return through an introduction.
		expect((await db.revocations.toArray()).map((r) => r.id).sort()).toEqual(['b', 'c-old']);
	});

	it('a device that was re-admitted since is not blocked', async () => {
		await db.peers.add(peer('a') as never);
		await db.revocations.add(eviction('a', 'readmitted') as never);
		const text = await createBackup({ sections: ['peers'] });
		await db.peers.clear();

		await restoreBackup(text);

		expect((await db.peers.toArray()).map((p) => p.id)).toEqual(['a']);
	});
});

describe('working set', () => {
	it('is exported from the store and merged into it on restore', async () => {
		const state = new Uint8Array([1, 2, 3, 250]);
		const importState = vi.fn(async () => []);
		setXactStore({ exportState: async () => state, importState } as never);

		const text = await createBackup({ sections: ['workingSet'] });
		const result = await restoreBackup(text);

		expect(result.restored).toEqual(['workingSet']);
		expect(importState).toHaveBeenCalledOnce();
		expect(Array.from((importState.mock.calls[0] as unknown as [Uint8Array])[0])).toEqual([
			1, 2, 3, 250
		]);
	});
});

describe('inspectBackup', () => {
	it('reports the version, the sections and the credentials block', async () => {
		const text = await createBackup({
			sections: ['settings', 'scx'],
			secretsPassphrase: PASSPHRASE
		});

		expect(inspectBackup(text)).toEqual({
			version: BACKUP_VERSION,
			sections: ['settings', 'scx'],
			hasSecrets: true,
			counts: { settings: 2, scx: 2, peers: 0 }
		});
	});

	it('reads a version 1 file', () => {
		const info = inspectBackup(JSON.stringify({ settings: [], scx: [] }));

		expect(info).toMatchObject({ version: 1, sections: ['settings', 'scx'], hasSecrets: false });
	});

	it('throws for a file that cannot be restored', () => {
		expect(() => inspectBackup('nope')).toThrow('not valid JSON');
	});
});
