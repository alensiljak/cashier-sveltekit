/*
    The shared settings as they travel between devices. The important properties: no secret is sent
    or shown, and a bad list never damages the settings here.
*/
import { beforeEach, describe, expect, it } from 'vitest';

import db from '#lib/data/db';
import { Setting } from '#lib/data/model';
import { SettingKeys, settings } from '#lib/settings';
import {
	exportSettingsJson,
	importSettingsJson,
	isEmptySettingsJson,
	readableSettingsJson
} from '#lib/services/backup';
import { settingsFile } from '#lib/services/s3Files';
import { getLocalData } from '#lib/sync/peerConnection.svelte';

const webdav = (password: string, url = 'https://dav.example.com') =>
	new Setting(SettingKeys.webdavSettings, JSON.stringify({ url, username: 'alice', password }));

const password = async () =>
	(await settings.get<{ password: string }>(SettingKeys.webdavSettings))?.password;

const stored = async () => (await db.settings.toArray()) as Setting[];

beforeEach(async () => {
	await db.settings.clear();
	await db.settings.bulkAdd([webdav('local-secret'), new Setting('currency', '"EUR"')]);
});

describe('what is sent and shown', () => {
	it('has no WebDAV password, on any channel', async () => {
		const exported = await exportSettingsJson();
		const peer = (await getLocalData(['settings'])).settings!;
		const s3 = new TextDecoder().decode((await settingsFile().read())!);

		for (const text of [exported, peer, s3]) {
			expect(text).toContain('https://dav.example.com');
			expect(text).not.toContain('local-secret');
		}
	});

	it('blanks the password of a list from an older version, and gives equal lists equal text', () => {
		const old = JSON.stringify([webdav('their-secret'), new Setting('currency', '"EUR"')], null, 2);
		const current = JSON.stringify([new Setting('currency', '"EUR"'), webdav('')]);

		expect(readableSettingsJson(old)).not.toContain('their-secret');
		expect(readableSettingsJson(old)).toBe(readableSettingsJson(current));
	});

	it('is a list that can be imported, also after a value was set to undefined', async () => {
		await settings.set(SettingKeys.userBookFilename, undefined);

		await expect(importSettingsJson(await exportSettingsJson())).resolves.toBeUndefined();
	});
});

describe('upload', () => {
	it('is refused by S3 for an empty list', async () => {
		await db.settings.clear();
		const file = settingsFile();
		const bytes = (await file.read())!;

		expect(isEmptySettingsJson(new TextDecoder().decode(bytes))).toBe(true);
		expect(() => file.checkUpload!(bytes)).toThrow('empty');
	});

	it('passes for a list with settings', async () => {
		const file = settingsFile();
		const bytes = (await file.read())!;

		expect(() => file.checkUpload!(bytes)).not.toThrow();
	});
});

describe('importSettingsJson', () => {
	const entry = { key: 'currency', value: '"USD"' };

	it.each([
		['not JSON', 'nope', 'not valid JSON'],
		['not a list', '{"a":1}', 'not a list'],
		['an empty list', '[]', 'empty'],
		['an entry that is not an object', JSON.stringify([entry, 5]), 'invalid entry'],
		['an entry that is null', JSON.stringify([null]), 'invalid entry'],
		['an entry without a key', JSON.stringify([{ value: '1' }]), 'invalid entry'],
		['an empty key', JSON.stringify([{ key: '', value: '1' }]), 'invalid entry'],
		['a value that is not text', JSON.stringify([{ key: 'a', value: 1 }]), 'invalid entry'],
		['a key twice', JSON.stringify([entry, entry]), 'more than once']
	])('rejects %s and keeps the settings', async (_name, content, message) => {
		const before = await stored();

		await expect(importSettingsJson(content)).rejects.toThrow(message);

		expect(await stored()).toEqual(before);
	});

	it('replaces the settings', async () => {
		await importSettingsJson(JSON.stringify([entry]));

		expect((await stored()).map((s) => [s.key, s.value])).toEqual([['currency', '"USD"']]);
	});

	it('keeps the password here for the same server', async () => {
		await importSettingsJson(JSON.stringify([webdav('')]));

		expect(await password()).toBe('local-secret');
	});

	it('does not take a password from the list', async () => {
		await importSettingsJson(JSON.stringify([webdav('their-secret')]));
		expect(await password()).toBe('local-secret');

		await importSettingsJson(JSON.stringify([webdav('their-secret', 'https://other.example.com')]));
		expect(await password()).toBe('');
	});
});
