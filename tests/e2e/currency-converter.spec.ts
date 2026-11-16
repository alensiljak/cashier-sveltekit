/**
 * Currency converter behavior against the demo book. The demo prices table
 * has commodity→EUR pairs (VTI, BND) and an AUD-only island (RING priced in
 * AUD, no AUD→EUR series), giving both a convertible pair and a pair with no
 * price path between the two currencies.
 *
 * The no-path case pins the worker guard in ledger.worker.ts: BQL's CONVERT
 * falls back to the unchanged amount in its original currency when no price
 * path exists, so a truthy number is not a successful conversion — the page
 * must show the "No conversion path" error instead of e.g. "100.0000 AUD".
 */
import { expect, test } from './fixtures';

test.describe('currency converter', () => {
	test('converts a pair the price table covers', async ({ demoPage: page }) => {
		await page.goto('/currency-converter?from=VTI&to=EUR');
		await page.locator('input[type="number"]').fill('1');

		// 1 VTI ≈ 221 EUR with the demo prices; the point is that it returns
		// EUR, not the unconverted input.
		const result = page.locator('p.text-3xl');
		await expect(result).toContainText('EUR');
		await expect(result).not.toContainText('VTI');
	});

	test('reports no conversion path instead of returning the input unchanged', async ({
		demoPage: page
	}) => {
		await page.goto('/currency-converter?from=AUD&to=EUR');
		await page.locator('input[type="number"]').fill('100');

		await expect(page.locator('.alert-error')).toContainText('No conversion path from AUD to EUR');
	});
});
