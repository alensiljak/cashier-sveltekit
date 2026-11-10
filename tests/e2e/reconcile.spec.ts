/**
 * Account reconciliation e2e test, on the demo book.
 *
 * The demo book has no balance assertions, so Assets:Bank:Checking starts as
 * "never reconciled". The test enters the book's own balance as the statement
 * balance, saves the resulting assertion and checks the account page reports it.
 */
import { expect, fab, test } from './fixtures';

const ACCOUNT = 'Assets:Bank:Checking';
const URL = `/accounts/reconcile?account=${encodeURIComponent(ACCOUNT)}`;

/** Parses an amount as the app formats it (en-US grouping, optional unicode minus). */
function parseAmount(text: string): number {
	return parseFloat(text.replace('−', '-').replace(/[^0-9.-]/g, ''));
}

test('reconciling the book balance saves an assertion', async ({ demoPage: page }) => {
	await page.goto(`/accounts/account-xacts/${encodeURIComponent(ACCOUNT)}`);
	const status = page.locator('header p', { hasText: /reconciled/i });
	await expect(status).toHaveText('Never reconciled');

	await page.goto(URL);
	const bookRow = page.locator('div.flex', { hasText: /^Book balance/ }).first();
	const bookAmount = bookRow.locator('data');
	await expect(bookAmount).toBeVisible();
	const book = parseAmount((await bookAmount.textContent()) ?? '');
	expect(Number.isNaN(book)).toBe(false);

	// A wrong statement balance shows a difference and offers no save button.
	const statement = page.locator('#statement-balance');
	await statement.fill(String(book + 10));
	await expect(fab(page)).toHaveCount(0);

	// The matching balance reconciles, and the check button appears.
	await statement.fill(String(book));
	await expect(page.getByText('The book agrees with the statement')).toBeVisible();
	await fab(page).click();

	await expect(page).toHaveURL(/\/accounts\/account-xacts\//);
	await expect(status).toHaveText(/Last reconciled on \d{4}-\d{2}-\d{2}/);
});

test('ticked transactions survive leaving the page', async ({ demoPage: page }) => {
	await page.goto(URL);
	const boxes = page.locator('ul input[type="checkbox"]');
	await expect(boxes.first()).toBeVisible();

	await boxes.first().check();
	await expect(page.getByText(/\(1\/\d+ ticked\)/)).toBeVisible();

	await page.goto('/');
	await page.goto(URL);
	await expect(boxes.first()).toBeChecked();
	await expect(page.getByText(/\(1\/\d+ ticked\)/)).toBeVisible();
});
