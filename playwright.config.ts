import type { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		// A cold production build can take longer than the 60s default.
		timeout: 240_000,
		// Exercise the proxy key path in preview without depending on the
		// developer's shell environment.
		env: { ...process.env, PROXY_KEY: 'e2e-proxy-key' } as Record<string, string>
	},
	testDir: 'tests/e2e',
	retries: process.env.CI ? 1 : 0,
	use: {
		// Keep a trace of the failing run only, so a flaky failure is debuggable.
		trace: 'retain-on-failure'
	}
};

export default config;
