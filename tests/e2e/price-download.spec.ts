/**
 * Price Download page e2e against the demo book. The demo book tags USD and
 * AUD with `EUR:ecbrates/…`, so the ECB provider has prices to download; the
 * page layout, remembered state and proxy key are exercised here.
 */
import { expect, test } from './fixtures';

test.describe('price download', () => {
	test('shows the book-driven layout; untagged commodities start collapsed', async ({
		demoPage: page
	}) => {
		await page.goto('/prices/download');

		// USD and AUD are tagged `EUR:ecbrates/…`, so the ECB provider is selected.
		await expect(page.getByRole('heading', { name: 'Providers' })).toBeVisible();
		const download = page.getByRole('button', { name: /Download 2 prices/ });
		await expect(download).toBeEnabled();
		await expect(download).toContainText('1 provider');

		// Sections are collapsed by default and the open state is remembered.
		const untagged = page.locator('details', { hasText: 'Untagged' });
		await expect(untagged).toBeVisible();
		await expect(untagged).not.toHaveAttribute('open', '');
		await untagged.locator('summary').click();
		await expect(untagged).toHaveAttribute('open', '');
		await page.reload();
		await expect(page.locator('details', { hasText: 'Untagged' })).toHaveAttribute('open', '');
	});

	test('destination and append mode are chosen on the page and remembered', async ({
		demoPage: page
	}) => {
		await page.goto('/prices/download');

		await page.getByRole('button', { name: 'Select' }).click();
		await expect(page).toHaveURL(/\/opfs\/file-picker/);
		await page.locator('#new-file-path').fill('prices/e2e-test.bean');
		await page.locator('button.btn-circle.btn-xl').click();
		await expect(page).toHaveURL('/prices/download');
		const destination = page.locator('p.truncate', { hasText: 'prices/e2e-test.bean' });
		await expect(destination).toBeVisible();

		await page.getByRole('checkbox', { name: 'Append history' }).check();
		await page.waitForTimeout(500);
		await page.reload();
		await expect(destination).toBeVisible();
		await expect(page.getByRole('checkbox', { name: 'Append history' })).toBeChecked();
	});
	test('proxy key is set from the toolbar menu dialog', async ({ demoPage: page }) => {
		await page.goto('/prices/download');

		const openProxyKey = async () => {
			await page.locator('.navbar .dropdown-end > button').click();
			await page.getByRole('menuitem', { name: 'Proxy key' }).click();
		};
		const dialog = page
			.locator('dialog.modal')
			.filter({ has: page.getByRole('heading', { name: 'Proxy key' }) });
		await openProxyKey();
		await expect(dialog).toBeVisible();

		const input = dialog.locator('input[type="password"]');
		await input.fill('e2e-proxy-key');
		await dialog.getByRole('button', { name: 'Save' }).click();
		await expect(dialog).not.toBeVisible();

		// Reopening shows the saved key, not the draft that was typed.
		await openProxyKey();
		await expect(input).toHaveValue('e2e-proxy-key');
	});

	test('proxy requires the key and rejects hosts outside its allowlist', async ({ request }) => {
		const target = encodeURIComponent('https://example.com/');

		const unauthorized = await request.get(`/api/proxy?url=${target}`);
		expect(unauthorized.status()).toBe(401);

		const response = await request.get(`/api/proxy?url=${target}`, {
			headers: { 'X-Proxy-Key': 'e2e-proxy-key' }
		});
		expect(response.status()).toBe(403);
		expect(await response.json()).toEqual({ error: 'Host not allowed: example.com' });
	});
});
