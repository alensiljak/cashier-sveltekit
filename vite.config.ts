import { sveltekit } from '@sveltejs/kit/vite';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
//import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
//import mkcert from 'vite-plugin-mkcert';
import path from 'path';
import type { Plugin } from 'vite';

// Emits build-info.json (unhashed name) with the real build time. It is kept out of the JS
// bundle on purpose: a timestamp inside a hashed chunk would rename that chunk, app.*.js and
// every prerendered page on each build. As a separate precached file, only it (and sw.js,
// which triggers the update prompt) change.
function buildInfo(): Plugin {
	return {
		name: 'build-info',
		applyToEnvironment: (env) => env.name === 'client',
		generateBundle() {
			// ISO 8601 in UTC (CI runs in UTC); the about page renders it in the viewer's timezone.
			const timestamp = new Date().toISOString();
			this.emitFile({
				type: 'asset',
				fileName: 'build-info.json',
				source: JSON.stringify({ buildTimestamp: timestamp })
			});
		}
	};
}

const config: UserConfig = defineConfig({
	server: {
		host: '0.0.0.0',
		// Ensure WASM files are served correctly in dev mode
		fs: {
			allow: ['..', path.resolve(import.meta.dirname, '..', '..', '..', 'node_modules')]
			//strict: false,
		}
		// Needed when running in a container and using source files on the host.
		// Or, use CHOKIDAR_USEPOLLING env var in devcontainer.json.
		// watch: {
		// 	usePolling: true,
		// 	interval: 500 // ms
		// }
	},
	build: {
		//sourcemap: process.env.SOURCE_MAP === 'true',
		sourcemap: false
	},
	plugins: [
		tailwindcss(),
		buildInfo(),
		// svelte(),
		sveltekit()
		// mkcert()
	]
});

// Vitest configuration is separate - see vitest.config.ts or package.json

export default config;
