import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts (which also configures the PWA plugin, dev
// server, etc. — none of which apply to the test run and some of which
// don't play well with Vitest's transform pipeline).
export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		// Svelte 5 ships separate browser/server builds; components must
		// resolve to the browser build under test so lifecycle (onMount,
		// effects) behaves as it does in the real app.
		conditions: ['browser']
	},
	test: {
		environment: 'jsdom',
		setupFiles: ['./tests/setup.ts'],
		include: ['tests/**/*.test.ts'],
		exclude: ['tests/e2e/**']
	}
});
