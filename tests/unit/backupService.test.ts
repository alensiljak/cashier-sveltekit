/*
    Backup/restore of settings and scheduled transactions (JSON file), against
    fake IndexedDB. The important properties: a backup restores what it saved,
    and a bad file never destroys existing data.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '$lib/data/db';
import { Setting } from '$lib/data/model';
import { SettingKeys } from '$lib/settings';
import appService from '$lib/services/appService';
import {
	createBackup,
	createBackupFile,
	getBackupFilename,
	restoreBackup
} from '$lib/services/backupService';

const scx = (payee: string, nextDate = '2026-01-01') => ({
	nextDate,
	period: 'months',
	count: 1,
	endDate: null,
	transaction: { date: nextDate, payee, postings: [], meta: {} }
});

async function seed() {
	await db.settings.clear();
	await db.scheduled.clear();
	await db.settings.bulkAdd([new Setting('currency', '"EUR"'), new Setting('theme', '"dark"')]);
	await db.scheduled.bulkAdd([scx('Rent'), scx('Gym', '2026-02-01')]);
}

const payees = async () =>
	(await db.scheduled.toArray()).map(
		(s: { transaction: { payee: string } }) => s.transaction.payee
	);

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
		const backup = JSON.parse(await createBackup());

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
		await db.scheduled.clear();

		expect(JSON.parse(await createBackup())).toEqual({ settings: [], scx: [] });
	});
});

describe('restoreBackup', () => {
	it('round-trips: restoring a backup brings back exactly what it saved', async () => {
		const backup = await createBackup();
		await db.settings.clear();
		await db.scheduled.clear();
		await db.settings.put(new Setting('other', '"x"'));

		await restoreBackup(backup);

		expect((await db.settings.toArray()).map((s: Setting) => s.key)).toEqual(['currency', 'theme']);
		expect(await payees()).toEqual(['Rent', 'Gym']);
		expect(await createBackup()).toBe(backup);
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
		['wrong types', JSON.stringify({ settings: {}, scx: 'x' })]
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
		const text = await createBackup();

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
		await createBackup();

		expect((await stored()).password).toBe('s3cret');
	});

	it('is kept on this device when restoring a backup for the same server and user', async () => {
		const backup = await createBackup();

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
		const backup = await createBackup();
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

		expect(JSON.parse(await createBackup()).settings.map((s: Setting) => s.value)).toContain(
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

		await createBackupFile('my-backup.json');

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
