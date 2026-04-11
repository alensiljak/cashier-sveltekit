import { sveltekit } from '@sveltejs/kit/vite';
import type { UserConfig } from 'vite';
//import { VitePWA } from 'vite-plugin-pwa'
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';
// import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import mkcert from 'vite-plugin-mkcert';

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
			allow: ['..']
		},
		// needed when running in a container and using source files on the host.
		watch: {
			usePolling: true,
			interval: 500 // ms
		}
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
			manifest: {
				id: '/',
				name: 'Cashier',
				short_name: 'cashier',
				description: 'Mobile app for Ledger-cli',
				categories: ['personal finance'],
				start_url: '/',
				orientation: 'portrait',
				theme_color: '#076461',
				background_color: '#000000',
				display: 'standalone',
				scope: '/',
				prefer_related_applications: false,
				icons: [
					{
						src: 'icons/icon-16.png',
						sizes: '16x16',
						type: 'image/png'
					},
					{
						src: 'icons/icon-32.png',
						sizes: '32x32',
						type: 'image/png'
					},
					{
						src: 'icons/icon-64.png',
						sizes: '64x64',
						type: 'image/png'
					},
					{
						src: 'icons/favicon-96x96.png',
						sizes: '96x96',
						type: 'image/png'
					},
					{
						src: 'icons/apple-icon-120x120.png',
						sizes: '120x120',
						type: 'image/png'
					},
					{
						src: 'icons/favicon-128x128.png',
						sizes: '128x128',
						type: 'image/png'
					},
					{
						src: 'icons/apple-icon-152x152.png',
						sizes: '152x152',
						type: 'image/png'
					},
					{
						src: 'icons/apple-icon-167x167.png',
						sizes: '167x167',
						type: 'image/png'
					},
					{
						src: 'icons/apple-icon-180x180.png',
						sizes: '180x180',
						type: 'image/png'
					},
					{
						src: 'icons/icon-192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: 'icons/icon-256x256.png',
						sizes: '256x256',
						type: 'image/png'
					},
					{
						src: 'icons/icon-384x384.png',
						sizes: '384x384',
						type: 'image/png'
					},
					{
						src: 'icons/icon-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'any'
					},
					{
						src: 'icons/maskable-icon-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
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
		}),
		// mkcert()
		//VitePWA({ registerType: 'autoUpdate' })
	]
});

// Vitest configuration is separate - see vitest.config.ts or package.json

export default config;
