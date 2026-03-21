import { expect, test } from '@playwright/test';

test.describe('RustLedger Integration Page', () => {
	test('rledger page loads and displays integration status', async ({ page }) => {
		await page.goto('/rledger');

		// Check page title
		expect(await page.textContent('h1')).toContain('RustLedger Demo');

		// Check that the page loads without crashing
		expect(await page.textContent('body')).not.toBeNull();
	});

	test('displays integration status section', async ({ page }) => {
		await page.goto('/rledger');

		// Check for integration status heading
		await expect(page.locator('text=Integration Status')).toBeVisible();

		// Wait for WASM to initialize (may take a moment)
		await page.waitForTimeout(2000);

		// Check that WASM status is displayed (either loaded or not loaded)
		const statusBadge = page.locator('text=WASM Loaded').or(page.locator('text=Not Loaded'));
		await expect(statusBadge).toBeVisible();
	});

	test('displays Beancount source textarea', async ({ page }) => {
		await page.goto('/rledger');

		// Check for Beancount source section
		await expect(page.locator('text=Beancount Source')).toBeVisible();

		// Check that the textarea is present
		await expect(page.locator('textarea')).toBeVisible();

		// Check that the parse button is present
		await expect(page.locator('button:has-text("Parse")')).toBeVisible();
	});

	test('displays parsed accounts section', async ({ page }) => {
		await page.goto('/rledger');

		// Wait for WASM initialization and parsing
		await page.waitForTimeout(2000);

		// Check for parsed accounts section
		await expect(page.locator('text=Parsed Accounts')).toBeVisible();

		// Verify that accounts are parsed and displayed
		// The exact number depends on whether WASM or fallback is used
		const accountsSection = page.locator('text=Parsed Accounts').locator('xpath=..');
		const accountCountText = await accountsSection.textContent();
		expect(accountCountText).toMatch(/Parsed Accounts \(\d+\)/);
	});

	test('displays current values section', async ({ page }) => {
		await page.goto('/rledger');

		// Wait for parsing to complete
		await page.waitForTimeout(2000);

		// Check for current values section
		await expect(page.locator('text=Current Values (Root: Assets)')).toBeVisible();

		// Verify that some current values are displayed
		// At minimum we should see the Assets accounts
		const assetsChecking = page.locator('text=Assets:Bank:Checking');
		await expect(assetsChecking).toBeVisible();
	});

	test('displays money tuple parsing test section', async ({ page }) => {
		await page.goto('/rledger');

		// Check for the test section
		await expect(page.locator('text=Money Tuple Parsing Test')).toBeVisible();

		// Verify test tuples are displayed with results
		await expect(page.locator('text=(100.00 EUR)')).toBeVisible();
		await expect(page.locator('text=(500.50 USD)')).toBeVisible();
		await expect(page.locator('text=(-25.75 GBP)')).toBeVisible();

		// Check that results are shown (arrow and parsed values)
		await expect(page.locator('text=→')).toBeVisible();
	});

	test('handles errors gracefully', async ({ page }) => {
		await page.goto('/rledger');

		// The page should load without throwing an unhandled error
		// Even if WASM fails, fallback should work
		expect(await page.textContent('body')).not.toContain('Uncaught');

		// The page should still be functional
		await expect(page.locator('text=Integration Status')).toBeVisible();
	});

	test('all sections are present', async ({ page }) => {
		await page.goto('/rledger');

		const expectedSections = [
			'Beancount Source',
			'Integration Status',
			'Parsed Accounts',
			'Current Values (Root: Assets)',
			'Money Tuple Parsing Test'
		];

		for (const section of expectedSections) {
			await expect(page.locator(`text=${section}`)).toBeVisible();
		}
	});
});
