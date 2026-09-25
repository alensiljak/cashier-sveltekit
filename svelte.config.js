import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// SvelteKit's default version is Date.now(). Any per-build value (timestamp, commit SHA) is
// inlined into a shared chunk and into the `__sveltekit_<hash>` global of every prerendered
// page, so each build renames nearly every file and the service worker re-downloads all of
// them. The app never reads the version and updates are detected via sw.js, so keep it constant.
const APP_VERSION = 'static';

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
		version: { name: APP_VERSION }
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
