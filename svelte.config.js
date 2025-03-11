import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

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
		prerender: { entries: ['*'] }
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
