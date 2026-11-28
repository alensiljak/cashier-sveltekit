/*
    Backup and restore e2e.

    Downloads a real backup from /backup, restores a modified copy of it through
    the file input, and checks the restored data shows up in the app and in the
    next backup. Also checks that an invalid file is rejected without touching
    the existing data.
*/
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import * as Y from 'yjs';
import { expect, test } from './fixtures';

interface BackupFile {
	version: number;
	settings: { key: string; value: string }[];
	/** The scheduled transactions' Yjs state, base64. */
	scx: string;
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
	expect(download.suggestedFilename()).toMatch(/^cashier-backup_\d{4}-\d\d-\d\d_\d{6}\.json\.gz$/);
	return JSON.parse(gunzipSync(readFileSync((await download.path())!)).toString('utf8'));
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

const selection = (page: Page) => page.getByRole('group', { name: 'Restore selection' });

/** The Restore button of the chosen file. */
const restoreButton = (page: Page) =>
	selection(page).getByRole('button', { name: 'Restore', exact: true });

/** Selects a file on /backup and restores it. */
async function restore(page: Page, content: string) {
	await chooseFile(page, content);
	await restoreButton(page).click();
}

/** What the page reports after the list of `withScxList(…, [rent])` was added. */
const RENT_ADDED = 'Scheduled transactions: 1 added, 0 changed, 0 deleted.';

/** A copy of `backup` as an older file, which holds the scheduled transactions as a list. */
const withScxList = (backup: BackupFile, list: unknown[]) =>
	JSON.stringify({ ...backup, version: 2, scx: list });

function payees(backup: BackupFile) {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, Buffer.from(backup.scx, 'base64'));
	const records = [...doc.getMap<{ transaction?: { payee?: string } }>('scx').values()];
	return records.map((s) => s.transaction?.payee);
}

test('a downloaded backup contains the demo settings', async ({ demoPage: page }) => {
	const backup = await downloadBackup(page);

	expect(backup.settings.length).toBeGreaterThan(0);
	expect(backup.settings.every((s) => typeof s.key === 'string')).toBe(true);
	expect(payees(backup).length).toBeGreaterThan(0);
});

test('restoring a backup brings its data back, and the next backup contains it', async ({
	demoPage: page
}) => {
	const original = await downloadBackup(page);
	expect(payees(original)).not.toContain('E2E Rent');

	await restore(page, withScxList(original, [rent]));
	await expect(page.getByText(RENT_ADDED)).toBeVisible();

	await page.goto('/scheduled-xacts');
	await expect(page.getByText('E2E Rent').first()).toBeVisible();

	// A list only adds: what was there is still there.
	const after = await downloadBackup(page);
	expect(payees(after).sort()).toEqual([...payees(original), 'E2E Rent'].sort());
	expect(after.settings).toEqual(original.settings);
});

test('destroying a store on the restore page, then restoring, returns to the backup', async ({
	demoPage: page
}) => {
	const original = await downloadBackup(page);
	await restore(page, withScxList(original, [rent]));
	await expect(page.getByText(RENT_ADDED)).toBeVisible();

	await chooseFile(page, JSON.stringify(original));
	await selection(page)
		.getByRole('button', { name: /Destroy local scheduled transactions/ })
		.click();
	const dialog = page.getByRole('alertdialog');
	await dialog.getByLabel('I accept permanent loss').check();
	await dialog.getByRole('button', { name: 'Destroy', exact: true }).click();
	await expect(dialog).toBeHidden();

	// The file stays chosen.
	await expect(selection(page).getByText(/merged: would add [1-9]/)).toBeVisible();
	await restoreButton(page).click();
	await expect(page.getByText(/Scheduled transactions: \d+ added/)).toBeVisible();

	const after = await downloadBackup(page);
	expect(payees(after).sort()).toEqual(payees(original).sort());
});

test('an invalid backup is rejected and existing data is kept', async ({ demoPage: page }) => {
	const original = await downloadBackup(page);
	await restore(page, withScxList(original, [rent]));
	await expect(page.getByText(RENT_ADDED)).toBeVisible();

	// A file that is not a backup is rejected when chosen, before anything can be restored,
	// and must not wipe what was just restored.
	await chooseFile(page, JSON.stringify({ hello: 'world' }));
	await expect(page.getByText(/Cannot restore, existing data was kept/)).toBeVisible();
	await expect(selection(page)).toBeHidden();

	const after = await downloadBackup(page);
	expect(payees(after).sort()).toEqual([...payees(original), 'E2E Rent'].sort());
	expect(after.settings).toEqual(original.settings);
});
