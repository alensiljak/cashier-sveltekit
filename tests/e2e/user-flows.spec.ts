/**
 * Everyday user flows on the demo book: the home overview, data surviving a
 * reload, editing and deleting transactions, scheduled transactions, and the
 * search/query pages. Each test starts from a fresh demo book (see fixtures.ts).
 *
 * Demo data these rely on: two device-journal entries (Corner Cafe, Supermarket),
 * three scheduled transactions (Landlord, Fitness Club, Savings Deposit), and the
 * ledger's 'Acme Corp' salary transactions.
 */
import type { Page } from '@playwright/test';
import { addTransaction, expect, fab, test } from './fixtures';

/** Opens a device-journal entry's action page by clicking its payee. */
async function openJournalEntry(page: Page, payee: string) {
	await page.goto('/journal');
	await page.getByText(payee).first().click();
	await expect(page).toHaveURL('/xact-actions');
}

/** Opens a scheduled transaction's action page from the list. */
async function openScheduled(page: Page, payee: string) {
	await page.goto('/scheduled-xacts');
	await page.getByText(payee).first().click();
	await expect(page).toHaveURL(/\/scx-actions\/\d+/);
}

/** The next-due date shown for a scheduled transaction in the list. */
async function nextDueDate(page: Page, payee: string): Promise<string> {
	await page.goto('/scheduled-xacts');
	await expect(page.locator('body')).toContainText(payee);
	const text = await page.locator('body').innerText();
	const match = text.match(new RegExp(`(\\d{4}-\\d\\d-\\d\\d)\\s+${payee}`));
	expect(match, `a due date before "${payee}"`).not.toBeNull();
	return match![1];
}

test.describe('home overview', () => {
	test('cards show balances, journal, upcoming and expenses from the demo book', async ({
		demoPage: page
	}) => {
		const body = page.locator('body');

		// Favourite accounts with real (non-zero) balances.
		await expect(body).toContainText(/Checking\s+-?[\d,]*[1-9][\d,]*\.\d\d\s+EUR/);
		await expect(body).toContainText(/CreditCard\s+-?[\d,]*[1-9][\d,]*\.\d\d\s+EUR/);
		// Device journal.
		await expect(body).toContainText('Supermarket');
		await expect(body).toContainText('Corner Cafe');
		// Upcoming scheduled transactions, with their amounts.
		await expect(body).toContainText(/Landlord\s+-900\.00\s+EUR/);
		await expect(body).toContainText('Fitness Club');
		await expect(body).toContainText('Savings Deposit');
		// Expenses.
		await expect(body).toContainText(/Groceries\s+27\.80/);
		// Forecast of the Wallet, drawn as a chart rather than the empty-state message.
		await expect(body).toContainText('Financial Forecast');
		await expect(body).not.toContainText('There are no accounts selected for forecasting');
		await expect(page.locator('canvas')).toBeVisible();
	});
});

test.describe('persistence', () => {
	test('device transactions survive a reload', async ({ demoPage: page }) => {
		const note = `Persisted ${Date.now()}`;
		await addTransaction(page, {
			note,
			expenseAccount: 'Expenses:Groceries',
			assetAccount: 'Assets:Bank:Checking',
			amount: '12.5'
		});
		await page.goto('/journal');
		await expect(page.locator('article', { hasText: note })).toBeVisible();

		await page.reload();

		await expect(page.locator('article', { hasText: note })).toBeVisible();
		await expect(page.locator('article', { hasText: 'Supermarket' })).toBeVisible();
	});

	test('the demo book and scheduled transactions survive a reload', async ({ demoPage: page }) => {
		await page.goto('/scheduled-xacts');
		await expect(page.getByText('Landlord')).toBeVisible();

		await page.reload();

		await expect(page.getByText('Landlord')).toBeVisible();
		await page.goto('/payees');
		await page.reload();
		await expect(page.getByText('Acme Corp')).toBeVisible();
	});
});

test.describe('device transactions', () => {
	test('editing a transaction updates the journal', async ({ demoPage: page }) => {
		await openJournalEntry(page, 'Corner Cafe');
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(page).toHaveURL('/tx');

		await page.getByTitle('Note', { exact: true }).fill('Espresso');
		await fab(page).click();
		await expect(page).not.toHaveURL('/tx');

		await page.goto('/journal');
		const entry = page.locator('article', { hasText: 'Corner Cafe' });
		await expect(entry).toContainText('Espresso');
		await expect(entry).not.toContainText('Coffee');
		// Edited in place, not duplicated.
		await expect(page.locator('article', { hasText: 'Corner Cafe' })).toHaveCount(1);
		await expect(page.locator('article', { hasText: 'Supermarket' })).toHaveCount(1);
	});

	test('deleting a transaction removes it from the journal', async ({ demoPage: page }) => {
		await openJournalEntry(page, 'Corner Cafe');

		await page.getByRole('button', { name: 'Delete', exact: true }).click();
		await page.getByRole('button', { name: 'OK' }).click();

		await expect(page).toHaveURL('/journal');
		await expect(page.locator('article', { hasText: 'Corner Cafe' })).toHaveCount(0);
		await expect(page.locator('article', { hasText: 'Supermarket' })).toBeVisible();
	});
});

test.describe('scheduled transactions', () => {
	test('lists the demo schedules and opens their actions', async ({ demoPage: page }) => {
		await page.goto('/scheduled-xacts');
		for (const payee of ['Landlord', 'Fitness Club', 'Savings Deposit']) {
			await expect(page.getByText(payee)).toBeVisible();
		}

		await openScheduled(page, 'Landlord');

		await expect(page.locator('body')).toContainText('Repeats every 1 months');
		for (const action of ['Enter', 'Skip', 'Edit', 'Delete']) {
			await expect(page.getByRole('button', { name: action, exact: true })).toBeVisible();
		}
	});

	test('entering a scheduled transaction saves it to the journal and moves it on', async ({
		demoPage: page
	}) => {
		const before = await nextDueDate(page, 'Landlord');
		await openScheduled(page, 'Landlord');

		await page.getByRole('button', { name: 'Enter', exact: true }).click();
		await page.getByRole('button', { name: 'OK' }).click();
		await expect(page).toHaveURL('/tx');
		await expect(page.getByTitle('Payee', { exact: true })).toHaveValue('Landlord');

		// Cancel: leave the edit form without saving. The transaction is already in the journal.
		await page.goto('/journal');
		await expect(page.locator('article', { hasText: 'Landlord' })).toHaveCount(1);
		// ISO dates sort as text: the next due date is later than before.
		expect((await nextDueDate(page, 'Landlord')) > before).toBe(true);
	});

	test('editing the entered transaction updates it instead of adding another', async ({
		demoPage: page
	}) => {
		await openScheduled(page, 'Landlord');
		await page.getByRole('button', { name: 'Enter', exact: true }).click();
		await page.getByRole('button', { name: 'OK' }).click();
		await expect(page).toHaveURL('/tx');

		await page.getByTitle('Note', { exact: true }).fill('October rent');
		await fab(page).click();
		await expect(page).not.toHaveURL('/tx');

		await page.goto('/journal');
		const entries = page.locator('article', { hasText: 'Landlord' });
		await expect(entries).toHaveCount(1);
		await expect(entries).toContainText('October rent');
	});

	test('deleting a scheduled transaction removes it from the list', async ({ demoPage: page }) => {
		await openScheduled(page, 'Fitness Club');

		await page.getByRole('button', { name: 'Delete', exact: true }).click();
		await page.getByRole('button', { name: 'OK' }).click();

		await page.goto('/scheduled-xacts');
		await expect(page.getByText('Landlord')).toBeVisible();
		await expect(page.getByText('Fitness Club')).toHaveCount(0);
	});

	test('a journal transaction can be scheduled to repeat', async ({ demoPage: page }) => {
		await openJournalEntry(page, 'Supermarket');
		await page.getByRole('button', { name: 'Schedule', exact: true }).click();
		await expect(page).toHaveURL('/scx-editor');

		await page.locator('input[type=radio]').nth(1).check(); // Repeats: Every ...
		await page.locator('main input[type=number]').last().fill('1');
		await page.locator('main select').selectOption('months');
		await fab(page).click();
		// Saving is async and ends with history.back(); navigating away sooner would abort it.
		await expect(page).not.toHaveURL('/scx-editor');

		await page.goto('/scheduled-xacts');
		await expect(page.getByText('Supermarket')).toBeVisible();
		await expect(page.getByText('Landlord')).toBeVisible();
	});
});

test.describe('search and queries', () => {
	test('a BQL query returns rows from the demo book', async ({ demoPage: page }) => {
		await page.goto('/reports/query');

		await page
			.getByPlaceholder('Enter BQL query...')
			.fill("SELECT account, sum(position) WHERE account ~ '^Expenses' GROUP BY account");
		await page.getByRole('button', { name: 'Query' }).click();

		await expect(page.getByText('Expenses:Groceries')).toBeVisible();
		await expect(page.getByText('Expenses:Rent')).toBeVisible();
		// Amounts are shown as readable text, not as raw JSON.
		await expect(page.locator('tbody')).toContainText(/\d{1,3}(,\d{3})*\.\d\d EUR/);
		await expect(page.locator('tbody')).not.toContainText('"positions"');
		await expect(page.locator('tbody')).not.toContainText('"units"');
	});

	test('transaction search filters by payee', async ({ demoPage: page }) => {
		await page.goto('/reports/tx-search');

		await page.getByPlaceholder('regex or text…').fill('Acme');
		await page.getByRole('button', { name: 'Search' }).click();

		await expect(page.getByText('Acme Corp').first()).toBeVisible();
		await expect(page.getByText('Monthly salary').first()).toBeVisible();
	});

	test('full-text search finds text in the demo files', async ({ demoPage: page }) => {
		await page.goto('/search/full-text');

		await page.getByPlaceholder('Search...').fill('Acme');

		await expect(page.getByText('cashier-demo/book.bean').first()).toBeVisible();
		await expect(page.getByText(/Acme Corp/).first()).toBeVisible();
	});
});
