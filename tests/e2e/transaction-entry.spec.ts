/**
 * Transaction entry -> journal e2e test.
 *
 * Seeds the built-in demo book (via onboarding) so real Expense/Asset accounts
 * are available to pick from, creates a new transaction (supermarket
 * shopping: Expenses:Groceries / Assets:Bank:Checking), saves it, then
 * verifies it shows up in the device journal.
 */
import { addTransaction, expect, test } from './fixtures';

test('creating a transaction shows it in the journal', async ({ demoPage: page }) => {
	const note = `Supermarket shopping ${Date.now()}`;
	await addTransaction(page, {
		note,
		expenseAccount: 'Expenses:Groceries',
		assetAccount: 'Assets:Bank:Checking',
		amount: '45.5'
	});

	await page.goto('/journal');

	const journalEntry = page.locator('article', { hasText: note });
	await expect(journalEntry).toBeVisible();
	// The account name is split across two spans (for text-truncation), so the
	// rendered text has a space around the colon that the source name doesn't.
	await expect(journalEntry).toContainText(/Expenses:\s*Groceries/);
	await expect(journalEntry).toContainText(/Assets:\s*Bank:Checking/);
});
