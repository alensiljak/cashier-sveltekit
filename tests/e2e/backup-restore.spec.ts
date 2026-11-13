/*
    Backup and restore e2e.

    Downloads a real backup from /backup, restores a modified copy of it through
    the file input, and checks the restored data shows up in the app and in the
    next backup. Also checks that an invalid file is rejected without touching
    the existing data.
*/
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

interface BackupFile {
	settings: { key: string; value: string }[];
	scx: { transaction?: { payee?: string } }[];
}

const rent = {
	nextDate: '2030-01-01',
	period: 'months',
	count: 1,
	endDate: null,
	transaction: {
		date: '2030-01-01',
		payee: 'E2E Rent',
		flag: '*',
		meta: {},
		postings: [
			{ account: 'Expenses:Rent', amount: 500, currency: 'EUR' },
			{ account: 'Assets:Bank:Checking', currency: 'EUR' }
		]
	}
};

/** Clicks Backup on /backup and returns the parsed downloaded file. */
async function downloadBackup(page: Page): Promise<BackupFile> {
	await page.goto('/sync/backup-file');
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Backup', exact: true }).click()
	]);
	expect(download.suggestedFilename()).toMatch(/^cashier-backup_\d{4}-\d\d-\d\d_\d{6}\.json$/);
	return JSON.parse(readFileSync((await download.path())!, 'utf8'));
}

/** Selects a file on /backup. */
async function chooseFile(page: Page, content: string) {
	await page.goto('/sync/backup-file');
	await page.locator('#backupFile').setInputFiles({
		name: 'backup.json',
		mimeType: 'application/json',
		buffer: Buffer.from(content)
	});
}

/** Selects a file on /backup and confirms the restore dialog. */
async function restore(page: Page, content: string) {
	await chooseFile(page, content);
	await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
}

const payees = (backup: BackupFile) => backup.scx.map((s) => s.transaction?.payee);

test('a downloaded backup contains the demo settings', async ({ demoPage: page }) => {
	const backup = await downloadBackup(page);

	expect(backup.settings.length).toBeGreaterThan(0);
	expect(backup.settings.every((s) => typeof s.key === 'string')).toBe(true);
	expect(Array.isArray(backup.scx)).toBe(true);
});

test('restoring a backup brings its data back, and the next backup contains it', async ({
	demoPage: page
}) => {
	const original = await downloadBackup(page);
	expect(payees(original)).not.toContain('E2E Rent');

	await restore(page, JSON.stringify({ ...original, scx: [rent] }));
	await expect(page.getByText('Backup restored')).toBeVisible();

	await page.goto('/scheduled-xacts');
	await expect(page.getByText('E2E Rent').first()).toBeVisible();

	const after = await downloadBackup(page);
	expect(payees(after)).toEqual(['E2E Rent']);
	expect(after.settings).toEqual(original.settings);
});

test('an invalid backup is rejected and existing data is kept', async ({ demoPage: page }) => {
	const original = await downloadBackup(page);
	await restore(page, JSON.stringify({ ...original, scx: [rent] }));
	await expect(page.getByText('Backup restored')).toBeVisible();

	// A file that is not a backup is rejected when chosen, before any restore dialog,
	// and must not wipe what was just restored.
	await chooseFile(page, JSON.stringify({ hello: 'world' }));
	await expect(page.getByText(/Cannot restore, existing data was kept/)).toBeVisible();
	await expect(page.getByRole('dialog')).toBeHidden();

	const after = await downloadBackup(page);
	expect(payees(after)).toEqual(['E2E Rent']);
	expect(after.settings).toEqual(original.settings);
});
