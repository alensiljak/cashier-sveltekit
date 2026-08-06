/**
 * Transaction entry -> journal e2e test.
 *
 * Seeds the built-in demo book (via onboarding) so real Expense/Asset accounts
 * are available to pick from, creates a new transaction (supermarket
 * shopping: Expenses:Groceries / Assets:Bank:Checking), saves it, then
 * verifies it shows up in the device journal.
 */
import { expect, test } from '@playwright/test';

test('creating a transaction shows it in the journal', async ({ page }) => {
	await page.goto('/onboarding');
	await page.getByRole('button', { name: 'Try demo data' }).click();
	await expect(page).toHaveURL('/');

	await page.goto('/tx');

	const note = `Supermarket shopping ${Date.now()}`;
	await page.getByPlaceholder('Note').fill(note);

	const accountFields = page.getByPlaceholder('Account');
	const amountFields = page.getByPlaceholder('Amount');

	// First posting: the expense side.
	await accountFields.nth(0).click();
	await expect(page).toHaveURL('/accounts');
	await page.getByText('Expenses:Groceries', { exact: true }).click();
	await expect(page).toHaveURL('/tx');
	await amountFields.nth(0).fill('45.5');

	// Second posting: the asset side, left auto-balancing.
	await accountFields.nth(1).click();
	await expect(page).toHaveURL('/accounts');
	await page.getByText('Assets:Bank:Checking', { exact: true }).click();
	await expect(page).toHaveURL('/tx');

	// Save (the FAB's check-mark button).
	await page.locator('button.btn-circle.btn-xl').click();

	await page.goto('/journal');

	const journalEntry = page.locator('article', { hasText: note });
	await expect(journalEntry).toBeVisible();
	// The account name is split across two spans (for text-truncation), so the
	// rendered text has a space around the colon that the source name doesn't.
	await expect(journalEntry).toContainText(/Expenses:\s*Groceries/);
	await expect(journalEntry).toContainText(/Assets:\s*Bank:Checking/);
});
