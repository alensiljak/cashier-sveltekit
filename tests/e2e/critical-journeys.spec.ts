/**
 * Critical-journey smoke tests.
 *
 * These run against a production build with no ledger data loaded (fresh
 * OPFS/IndexedDB per worker) — they verify the app shell, routing, and each
 * critical page render without throwing, not specific data output. Deeper
 * data-dependent flows (import, sync, backup/restore round-trips) need
 * seeded OPFS state and belong in their own spec once that fixture exists.
 */
import { expect, test } from '@playwright/test';

test.describe('app shell', () => {
	test('home page loads with toolbar and quick-entry FAB', async ({ page }) => {
		await page.goto('/');

		await expect(page.getByText('Cashier', { exact: true }).first()).toBeVisible();
		await expect(page.locator('button.btn-circle.btn-xl')).toBeVisible();
	});

	test('quick-entry FAB navigates to transaction search', async ({ page }) => {
		await page.goto('/');

		await page.locator('button.btn-circle.btn-xl').click();

		await expect(page).toHaveURL(/\/tx\/search-new/);
	});
});

test.describe('critical pages render', () => {
	for (const [path, title] of [
		['/journal', 'Journal'],
		['/reports', 'Reports'],
		['/settings', 'Settings'],
		['/accounts', 'Accounts'],
		['/scheduled-xacts', 'Scheduled'],
		['/favourites', 'Favourites']
	] as const) {
		test(`${path} renders its toolbar title`, async ({ page }) => {
			await page.goto(path);

			await expect(page.locator('.navbar p', { hasText: title })).toBeVisible();
		});
	}
});
