/**
 * Critical-journey smoke tests, run against a production build with fresh
 * OPFS/IndexedDB per test. Every test starts from the built-in demo book so
 * pages are exercised with real data, and fails on any uncaught page error
 * or console error (see fixtures.ts).
 *
 * Other data-dependent flows (import, sync, backup/restore round-trips) live
 * in their own specs.
 */
import { expect, test } from './fixtures';

test.describe('app shell', () => {
	test('home page loads with toolbar and quick-entry FAB', async ({ demoPage: page }) => {
		await expect(page.getByText('Cashier', { exact: true }).first()).toBeVisible();
		await expect(page.locator('button.btn-circle.btn-xl')).toBeVisible();
	});

	test('quick-entry FAB navigates to quick entry', async ({ demoPage: page }) => {
		await page.locator('button.btn-circle.btn-xl').click();

		await expect(page).toHaveURL(/\/tx\/quick-entry/);
	});
});

/**
 * Route sweep: each page opens with demo data, shows its toolbar title and
 * some content from the demo book (`expected`), and raises no errors.
 */
const pages: { path: string; title: string; expected?: string | RegExp }[] = [
	{ path: '/journal', title: 'Device Journal' },
	{ path: '/accounts', title: 'Accounts', expected: 'Expenses:Groceries' },
	{ path: '/payees', title: 'Payees', expected: 'Acme Corp' },
	{ path: '/commodities', title: 'Commodities', expected: 'VTI' },
	{ path: '/securities', title: 'Securities', expected: 'VTI' },
	{ path: '/budget', title: 'Budget' },
	{ path: '/ledger', title: 'Ledger Debug' },
	{ path: '/search', title: 'Search' },
	{ path: '/reports', title: 'Reports' },
	{ path: '/reports/balance-sheet', title: 'Balance Sheet', expected: /Assets/ },
	{ path: '/reports/income-statement', title: 'Income Statement', expected: /Income/ },
	{ path: '/reports/trial-balance', title: 'Trial Balance', expected: /Assets/ },
	{ path: '/reports/net-worth', title: 'Net Worth' },
	{ path: '/reports/expenses', title: 'Expenses' },
	{ path: '/reports/portfolio-returns', title: 'Portfolio Returns' },
	{
		path: '/forecast-settings',
		title: 'Financial Forecast Settings',
		expected: 'Assets:Cash:Wallet'
	},
	{ path: '/scheduled-xacts', title: 'Scheduled Transactions' },
	{ path: '/favourites', title: 'Favourites' },
	{ path: '/settings', title: 'Settings' }
];

test.describe('pages render with demo data', () => {
	for (const { path, title, expected } of pages) {
		test(path, async ({ demoPage: page }) => {
			await page.goto(path);

			await expect(page.locator('.navbar p.font-bold', { hasText: title })).toBeVisible();
			if (expected) {
				await expect(page.getByText(expected).first()).toBeVisible();
			}
		});
	}
});

test.describe('asset allocation with demo data', () => {
	test('opens and calculates values from the seeded demo book', async ({ demoPage: page }) => {
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
