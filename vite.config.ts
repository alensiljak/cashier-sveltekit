import { sveltekit } from '@sveltejs/kit/vite';
import type { UserConfig } from 'vite';
//import { VitePWA } from 'vite-plugin-pwa'
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
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
			const d = new Date();
			const pad = (n: number) => String(n).padStart(2, '0');
			const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
		sveltekit(),
		SvelteKitPWA({
			strategies: 'generateSW',
			// registerType: 'prompt',  // this is the default.
			//mode: 'development',
			mode: 'production',
			injectRegister: false,
			scope: '/',
			base: '/',
			//selfDestroying: process.env.SELF_DESTROYING_SW === 'true',
			selfDestroying: false,
			pwaAssets: {
				config: true
			},
			injectManifest: {
				globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,woff,woff2,wasm}']
			},
			workbox: {
				globPatterns: [
					'client/**/*.{js,css,ico,png,svg,txt,webp,webmanifest,wasm,json}',
					'prerendered/**/*.html'
				],
				maximumFileSizeToCacheInBytes: 10 * 1024 * 1024 // 10 MB (adjust as needed)
			},
			devOptions: {
				enabled: process.env.SW_DEV === 'true',
				suppressWarnings: process.env.SUPPRESS_WARNING === 'true',
				type: 'module',
				navigateFallback: '/index.html'
			},
			kit: {
				includeVersionFile: true
			}
		})
		// mkcert()
		//VitePWA({ registerType: 'autoUpdate' })
	]
});

// Vitest configuration is separate - see vitest.config.ts or package.json

export default config;
