import { sveltekit } from '@sveltejs/kit/vite';
import type { UserConfig } from 'vite';
//import { VitePWA } from 'vite-plugin-pwa'
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';
//import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
//import mkcert from 'vite-plugin-mkcert';
import path from 'path';

// Generate build timestamp in YYYY-MM-DD HH:mm format (local timezone)
const now = new Date();
const buildTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

const config: UserConfig = defineConfig({
	define: {
		__BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp)
	},
	server: {
		host: '0.0.0.0',
		// Ensure WASM files are served correctly in dev mode
		fs: {
			allow: ['..', path.resolve(__dirname, '..', '..', '..', 'node_modules')]
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
					'client/**/*.{js,css,ico,png,svg,txt,webp,webmanifest,wasm}',
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
