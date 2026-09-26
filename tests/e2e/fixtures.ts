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

export { expect };
