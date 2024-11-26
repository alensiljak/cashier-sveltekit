import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
// import sveltePreprocess from 'svelte-preprocess';

/** @type {import('@sveltejs/kit').Config} */
const config = {
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
			assets: 'build',
		}),
		prerender: { entries: ['*'] },
	},
	runes: true,
};

export default config;
