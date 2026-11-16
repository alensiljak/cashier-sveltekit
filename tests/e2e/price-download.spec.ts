/**
 * Price download e2e against the demo book, with the Frankfurter endpoint
 * mocked via a Playwright route (no network) — the demo book gives a real
 * book-relevant symbol plan: EUR operating currency, VTI/BND commodities
 * (classified out, not exchange rates) and the AUD quote side of the RING
 * prices.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const DEFAULT_DESTINATION = 'prices/prices.current.bean';

/** Read a file straight from OPFS; null when it does not exist. */
async function readOpfsFile(page: Page, path: string): Promise<string | null> {
	return page.evaluate(async (p) => {
		const parts = p.split('/');
		const name = parts.pop()!;
		let dir = await navigator.storage.getDirectory();
		try {
			for (const part of parts) dir = await dir.getDirectoryHandle(part);
			const handle = await dir.getFileHandle(name);
			return (await handle.getFile()).text();
		} catch {
			return null;
		}
	}, path);
}

async function mockFixing(page: Page, date: string, rate: string) {
	await page.route('**/api.frankfurter.dev/**', async (route) => {
		await route.fulfill({
			json: [{ date, base: 'EUR', quote: 'AUD', rate: Number(rate) }]
		});
	});
}

test.describe('price download', () => {
	test('previews book-relevant symbols and writes the latest fixing', async ({
		demoPage: page
	}) => {
		await mockFixing(page, '2026-01-05', '1.6111');

		await page.goto('/prices/download');

		// Preview: AUD is book-relevant (RING is quoted in AUD). The declared
		// securities (VTI, BND, RING, UBUD.DE) are not exchange rates and are
		// classified out of the FX plan entirely.
		await expect(page.getByText('EUR → AUD', { exact: true })).toBeVisible();
		await expect(page.locator('.badge-neutral', { hasText: 'your series' })).toHaveCount(0);
		await expect(page.getByText('Securities in the book are not exchange rates')).toHaveCount(0);

		const download = page.getByRole('button', { name: 'Download latest rates' });
		await expect(download).toBeEnabled();
		await download.click();

		// Result card: fixing date echoed, one line written.
		const resultCard = page.locator('.card.bg-base-200');
		await expect(resultCard).toContainText('2026-01-05', { timeout: 10_000 });
		await expect(resultCard).toContainText('1 line added');

		// Status card and the destination file in OPFS.
		const statusCard = page.locator('.card', { hasText: 'Last run' });
		await expect(statusCard).toContainText('2026-01-05');
		await expect(statusCard).toContainText(DEFAULT_DESTINATION);
		await expect(statusCard).toContainText('Lines in file:');
		expect(await readOpfsFile(page, DEFAULT_DESTINATION)).toBe(
			'; ECB reference rates (via Frankfurter) — latest fixing: 2026-01-05\n' +
				'2026-01-05 price EUR 1.6111 AUD\n'
		);
	});

	test('writes to a user-chosen destination file in append mode', async ({ demoPage: page }) => {
		await mockFixing(page, '2026-01-05', '1.6111');

		await page.goto('/prices/download');

		// Choose a fresh destination through the shared OPFS picker.
		await page.getByRole('button', { name: 'Select' }).click();
		await expect(page).toHaveURL(/\/opfs\/file-picker/);
		await page.locator('#new-file-path').fill('prices/e2e-test.bean');
		await page.locator('button.btn-circle.btn-xl').click();
		await expect(page).toHaveURL('/prices/download');
		await expect(page.getByText('prices/e2e-test.bean', { exact: true })).toBeVisible();

		await page.locator('input[type="checkbox"].toggle').click();

		await page.getByRole('button', { name: 'Download latest rates' }).click();

		const resultCard = page.locator('.card.bg-base-200');
		await expect(resultCard).toContainText('2026-01-05', { timeout: 10_000 });
		await expect(resultCard).toContainText('1 line added');
		expect(await readOpfsFile(page, 'prices/e2e-test.bean')).toBe(
			'2026-01-05 price EUR 1.6111 AUD\n'
		);
		// The default destination was not touched.
		expect(await readOpfsFile(page, DEFAULT_DESTINATION)).toBeNull();

		// Run again with the next fixing: the file keeps both dates (append).
		await mockFixing(page, '2026-01-06', '1.6222');
		await page.getByRole('button', { name: 'Download latest rates' }).click();
		await expect(resultCard).toContainText('2026-01-06', { timeout: 10_000 });
		await expect(resultCard).toContainText('2 lines in file');
		expect(await readOpfsFile(page, 'prices/e2e-test.bean')).toBe(
			'2026-01-05 price EUR 1.6111 AUD\n2026-01-06 price EUR 1.6222 AUD\n'
		);
	});

	test('overwrite mode replaces the file with the latest fixing', async ({ demoPage: page }) => {
		await mockFixing(page, '2026-01-05', '1.6111');
		await page.goto('/prices/download');
		await page.getByRole('button', { name: 'Download latest rates' }).click();
		await expect(page.locator('.card.bg-base-200')).toContainText('1 line added', {
			timeout: 10_000
		});

		await mockFixing(page, '2026-01-06', '1.6222');
		await page.getByRole('button', { name: 'Download latest rates' }).click();
		await expect(page.locator('.card.bg-base-200')).toContainText('2026-01-06', {
			timeout: 10_000
		});

		expect(await readOpfsFile(page, DEFAULT_DESTINATION)).toBe(
			'; ECB reference rates (via Frankfurter) — latest fixing: 2026-01-06\n' +
				'2026-01-06 price EUR 1.6222 AUD\n'
		);
	});

	test('re-running the same fixing reports no changes and leaves the file untouched', async ({
		demoPage: page
	}) => {
		await mockFixing(page, '2026-01-05', '1.6111');
		await page.goto('/prices/download');
		await page.getByRole('button', { name: 'Download latest rates' }).click();
		await expect(page.locator('.card.bg-base-200')).toContainText('1 line added', {
			timeout: 10_000
		});
		const written = await readOpfsFile(page, DEFAULT_DESTINATION);

		await page.getByRole('button', { name: 'Download latest rates' }).click();
		await expect(page.locator('.card.bg-base-200')).toContainText('already in', {
			timeout: 10_000
		});
		await expect(page.locator('.card.bg-base-200')).toContainText('no changes');
		expect(await readOpfsFile(page, DEFAULT_DESTINATION)).toBe(written);
	});
});
