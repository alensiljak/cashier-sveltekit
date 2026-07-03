/**
 * Critical-journey smoke tests.
 *
 * These run against a production build with fresh OPFS/IndexedDB per test
 * (each Playwright test gets its own browser context). Most cases below
 * start with no ledger data and verify the app shell, routing, and each
 * critical page render without throwing, not specific data output.
 *
 * The "asset allocation with demo data" suite seeds the built-in demo
 * book via the onboarding flow, then asserts on calculated data. Other
 * data-dependent flows (import, sync, backup/restore round-trips) still
 * need their own seeding and belong in their own spec.
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

			await expect(page.locator('.navbar p.font-bold', { hasText: title })).toBeVisible();
		});
	}
});

test.describe('asset allocation with demo data', () => {
	test('opens and calculates values from the seeded demo book', async ({ page }) => {
		await page.goto('/onboarding');

		await page.getByRole('button', { name: 'Try demo data' }).click();
		await expect(page).toHaveURL('/');

		await page.goto('/asset-allocation');

		// Root asset classes from the demo target (asset-allocation.toml).
		for (const name of ['Equity', 'Bonds', 'Cash']) {
			await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
		}

		await expect(page.getByText('No asset allocation data available')).not.toBeVisible();

		// Values are calculated from seeded holdings/prices, not left at zero.
		const rows = page.locator('table tbody tr');
		await expect(rows).not.toHaveCount(0);

		const equityRow = rows.filter({ has: page.getByRole('link', { name: 'Equity', exact: true }) });
		const currentValueCell = equityRow.locator('td').nth(5);
		await expect(currentValueCell).not.toHaveText('0.00');
		await expect(currentValueCell).not.toHaveText('');
	});
});
