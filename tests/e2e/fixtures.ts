/**
 * Shared Playwright fixtures.
 *
 * - `errors` (auto): collects uncaught page errors and console errors during
 *   a test and fails it if any occurred, so a page that "renders" while
 *   throwing in the background is still caught.
 * - `demoPage`: a page with the built-in demo book already loaded through the
 *   onboarding flow (each test has fresh OPFS/IndexedDB, so this is per test).
 */
import { expect, test as base, type Page } from '@playwright/test';

// Browser-level noise that isn't an app bug (e.g. a missing favicon or icon).
const IGNORED_CONSOLE_ERRORS = [/Failed to load resource/];

export const test = base.extend<{ errors: string[]; demoPage: Page }>({
	errors: [
		async ({ page }, use) => {
			const errors: string[] = [];
			page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
			page.on('console', (msg) => {
				if (msg.type() !== 'error') return;
				const text = msg.text();
				if (IGNORED_CONSOLE_ERRORS.some((re) => re.test(text))) return;
				errors.push(`console.error: ${text}`);
			});
			await use(errors);
			expect(errors, 'unexpected page/console errors').toEqual([]);
		},
		{ auto: true }
	],

	demoPage: async ({ page }, use) => {
		await loadDemoData(page);
		await use(page);
	}
});

/** Seeds the demo book via onboarding and waits for the home page. */
export async function loadDemoData(page: Page) {
	await page.goto('/onboarding');
	await page.getByRole('button', { name: 'Try demo data' }).click();
	await expect(page).toHaveURL('/');
}

/** The FAB's save/add button (a check mark on entry forms, a plus on lists). */
export const fab = (page: Page) => page.locator('button.btn-circle.btn-xl');

/**
 * Creates a two-posting transaction through the /tx form, picking accounts from
 * the account list, and waits until saving has finished (it ends with history.back()).
 * The second posting is left empty so it auto-balances.
 */
export async function addTransaction(
	page: Page,
	opts: { note: string; expenseAccount: string; assetAccount: string; amount: string }
) {
	await page.goto('/tx');
	await page.getByTitle('Note', { exact: true }).fill(opts.note);

	const accountFields = page.getByTitle('Account', { exact: true });
	const amountFields = page.getByTitle('Amount', { exact: true });

	await accountFields.nth(0).click();
	await expect(page).toHaveURL('/accounts');
	await page.getByText(opts.expenseAccount, { exact: true }).click();
	await expect(page).toHaveURL('/tx');
	await amountFields.nth(0).fill(opts.amount);

	await accountFields.nth(1).click();
	await expect(page).toHaveURL('/accounts');
	await page.getByText(opts.assetAccount, { exact: true }).click();
	await expect(page).toHaveURL('/tx');

	await fab(page).click();
	// Saving is async and ends with history.back(); navigating away sooner would abort it.
	await expect(page).not.toHaveURL('/tx');
}

export { expect };
