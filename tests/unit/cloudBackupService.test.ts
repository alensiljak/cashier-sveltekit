/*
    Cloud backup: file naming and the WebDAV directory-listing helpers.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
	putFileContents: vi.fn(async () => true),
	getDirectoryContents: vi.fn()
}));
vi.mock('webdav', () => ({ createClient: vi.fn(() => client) }));
vi.mock('$lib/services/appService', () => ({
	default: { getScheduledXactsForExport: vi.fn(async () => '[{"id":1}]') }
}));

import appService from '$lib/services/appService';
import { CloudBackupService, getFilenameForBackup } from '$lib/services/cloudBackupService';
import { BackupType } from '$lib/enums';

describe('getFilenameForBackup', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 7, 15, 9, 5, 7));
	});
	afterEach(() => vi.useRealTimers());

	it('is prefixed with the lower-cased type and stamped with date and time', () => {
		expect(getFilenameForBackup(BackupType.SCHEDULEDXACTS)).toBe(
			`${BackupType.SCHEDULEDXACTS.toLowerCase()}_2026-08-15_090507.json`
		);
	});

	it('uses the ledger extension for journal backups', () => {
		expect(getFilenameForBackup(BackupType.JOURNAL)).toMatch(/_2026-08-15_090507\.ledger$/);
	});
});

describe('CloudBackupService', () => {
	const listing = (...names: string[]) => names.map((basename) => ({ basename }));
	let service: CloudBackupService;

	beforeEach(() => {
		client.putFileContents.mockClear();
		client.getDirectoryContents.mockReset();
		service = new CloudBackupService('https://dav.example.com');
	});

	it('uploads the exported scheduled transactions under a timestamped name', async () => {
		await service.backupScheduledXacts();

		const [path, body] = client.putFileContents.mock.calls[0] as unknown as [string, string];
		expect(path).toMatch(new RegExp(`^/${BackupType.SCHEDULEDXACTS.toLowerCase()}_.*\\.json$`));
		expect(body).toBe('[{"id":1}]');
	});

	it('fails when there is nothing to export', async () => {
		vi.mocked(appService.getScheduledXactsForExport).mockResolvedValueOnce('');

		await expect(service.backupScheduledXacts()).rejects.toThrow('Error retrieving');
		expect(client.putFileContents).not.toHaveBeenCalled();
	});

	it('counts and finds the latest backups, ignoring other files', async () => {
		const prefix = BackupType.SCHEDULEDXACTS.toLowerCase();
		client.getDirectoryContents.mockResolvedValue(
			listing(`${prefix}_2026-01-01_000000.json`, `${prefix}_2026-03-01_000000.json`, 'notes.txt')
		);

		expect(await service.getRemoteBackupCount(prefix)).toBe(2);
		expect(await service.getLatestFilename()).toBe(`${prefix}_2026-03-01_000000.json`);
	});

	it('caches the directory listing until cleared', async () => {
		client.getDirectoryContents.mockResolvedValue(listing('a'));

		await service.getFileListing();
		await service.getFileListing();
		expect(client.getDirectoryContents).toHaveBeenCalledTimes(1);

		service.clearCache();
		await service.getFileListing();
		expect(client.getDirectoryContents).toHaveBeenCalledTimes(2);
	});
});
