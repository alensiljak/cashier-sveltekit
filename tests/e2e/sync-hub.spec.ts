/*
    Sync hub e2e: /sync on demo data (no sync option is enabled there), following its links,
    and the stale-period setting surviving a reload.
*/
import { expect, test } from './fixtures';

test('the hub says so when no sync option is selected', async ({ demoPage: page }) => {
	await page.goto('/sync');

	await expect(page.getByRole('heading', { name: 'More' })).toBeVisible();
	await expect(page.getByText('No sync options selected')).toBeVisible();
	await expect(page.locator('[data-testid^="channel-"]')).toHaveCount(0);
});

test('the hub links to the backup file page and to the sync options', async ({
	demoPage: page
}) => {
	await page.goto('/sync');

	await page.getByRole('link', { name: /Backup file/ }).click();
	await expect(page).toHaveURL('/sync/backup-file');

	await page.goto('/sync');
	await page.getByRole('link', { name: /Sync options/ }).click();
	await expect(page).toHaveURL(/\/settings/);
});

test('the stale period is remembered', async ({ demoPage: page }) => {
	await page.goto('/sync');
	const select = page.getByTestId('stale-days');
	await expect(select).toHaveValue('7');

	await select.selectOption('14');
	await expect(select).toHaveValue('14');

	await page.reload();
	await expect(page.getByTestId('stale-days')).toHaveValue('14');
});
