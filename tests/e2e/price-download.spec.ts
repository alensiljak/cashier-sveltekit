/**
 * Price download e2e against the demo book, with the Frankfurter endpoint
 * mocked via a Playwright route (no network) — the demo book gives a real
 * book-relevant symbol plan: EUR operating currency, VTI/BND commodities
 * (skipped as unsupported) and the AUD quote side of the RING prices.
 */
import { expect, test } from './fixtures';

test.describe('price download', () => {
	test('previews book-relevant symbols and writes the latest fixing', async ({
		demoPage: page
	}) => {
		await page.route('**/api.frankfurter.dev/**', async (route) => {
			await route.fulfill({
				json: [{ date: '2026-01-05', base: 'EUR', quote: 'AUD', rate: 1.6111 }]
			});
		});

		await page.goto('/prices/download');

		// Preview: AUD is book-relevant (RING is quoted in AUD); the declared
		// securities (VTI, BND, RING, UBUD.DE) are not exchange rates and are
		// listed separately, not as missing rates.
		await expect(page.getByText('EUR → AUD', { exact: true })).toBeVisible();
		await expect(page.locator('.badge-neutral', { hasText: 'your series' })).toHaveCount(0);
		await expect(page.getByText(/Securities in the book are not exchange rates/)).toBeVisible();

		const download = page.getByRole('button', { name: 'Download latest rates' });
		await expect(download).toBeEnabled();
		await download.click();

		// Result card: fixing date echoed, one line written.
		const resultCard = page.locator('.card.bg-base-200');
		await expect(resultCard).toContainText('2026-01-05', { timeout: 10_000 });
		await expect(resultCard).toContainText('1 line added');
	});

	test('writes to a user-chosen destination file in append mode', async ({ demoPage: page }) => {
		await page.route('**/api.frankfurter.dev/**', async (route) => {
			await route.fulfill({
				json: [{ date: '2026-01-05', base: 'EUR', quote: 'AUD', rate: 1.6111 }]
			});
		});

		await page.goto('/prices/download');

		// Point at a fresh destination and turn on append history.
		await page.locator('input[type="text"]').fill('prices/e2e-test.bean');
		const appendToggle = page.locator('input[type="checkbox"].toggle');
		await appendToggle.click();

		await page.getByRole('button', { name: 'Download latest rates' }).click();

		// Result card: fixing date echoed, one line written.
		const resultCard = page.locator('.card.bg-base-200');
		await expect(resultCard).toContainText('2026-01-05', { timeout: 10_000 });

		// Run again with the next fixing: the file keeps both dates (append).
		await page.route('**/api.frankfurter.dev/**', async (route) => {
			await route.fulfill({
				json: [{ date: '2026-01-06', base: 'EUR', quote: 'AUD', rate: 1.6222 }]
			});
		});
		await page.getByRole('button', { name: 'Download latest rates' }).click();
		await expect(resultCard).toContainText('2026-01-06', { timeout: 10_000 });
		await expect(resultCard).toContainText('2 lines in file');
	});
});
