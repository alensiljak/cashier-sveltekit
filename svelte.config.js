import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { execSync } from 'node:child_process';

// SvelteKit's default version is Date.now(), which is inlined into a shared chunk.
// That changes the hash of every route chunk on every build, so the service worker
// re-downloads everything. Use the commit SHA so identical sources give identical output.
function buildVersion() {
	if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
	try {
		return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return String(Date.now());
	}
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// svelte options
	extensions: ['.svelte'],
	compilerOptions: {},
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	// preprocess: vitePreprocess({
	// 	sourceMap: true, // Enable source maps for preprocessing
	// }),
	// compilerOptions: {
	//     enableSourcemap: true, // Enable sourcemaps in the compiler
	// },

	kit: {
		adapter: adapter({
			fallback: 'index.html',
			pages: 'build',
			assets: 'build'
		}),
		prerender: { entries: ['*'] },
		version: { name: buildVersion() }
	},
	runes: true,
	// plugin options
	vitePlugin: {
		exclude: [],
		// experimental options
		experimental: {}
	}
};

export default config;
