import { sveltekit } from '@sveltejs/kit/vite';
import type { UserConfig } from 'vite';
//import { VitePWA } from 'vite-plugin-pwa'
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

const config: UserConfig = defineConfig({
	build: {
		sourcemap: process.env.SOURCE_MAP === 'true',
	},
	plugins: [
		sveltekit(),
		SvelteKitPWA({
			strategies: 'generateSW',
			// registerType: 'prompt',  // this is the default.
			mode: 'development',
			injectRegister: false,
			scope: '/',
			base: '/',
			selfDestroying: process.env.SELF_DESTROYING_SW === 'true',
			pwaAssets: {
				config: true,
			},
			manifest: {
				"id": '/',
				"name": "Cashier",
				"short_name": "cashier",
  				"description": "Mobile app for Ledger-cli",
				"categories": ['personal finance'],
				"start_url": '/',
				"orientation": "portrait",
				"theme_color": "#076461",
				"background_color": "#000000",
				"display": 'standalone',
				"scope": '/',
				"prefer_related_applications": false,
				"icons": [
					{
						"src": "icons/icon-16.png",
						"sizes": "16x16",
						"type": "image/png"
					},
					{
						"src": "icons/icon-32.png",
						"sizes": "32x32",
						"type": "image/png"
					},
					{
						"src": "icons/icon-64.png",
						"sizes": "64x64",
						"type": "image/png"
					},
					{
						"src": "icons/favicon-96x96.png",
						"sizes": "96x96",
						"type": "image/png"
					},
					{
						"src": "icons/apple-icon-120x120.png",
						"sizes": "120x120",
						"type": "image/png"
					},
					{
						"src": "icons/favicon-128x128.png",
						"sizes": "128x128",
						"type": "image/png"
					},
					{
						"src": "icons/apple-icon-152x152.png",
						"sizes": "152x152",
						"type": "image/png"
					},
					{
						"src": "icons/apple-icon-167x167.png",
						"sizes": "167x167",
						"type": "image/png"
					},
					{
						"src": "icons/apple-icon-180x180.png",
						"sizes": "180x180",
						"type": "image/png"
					},
					{
						"src": "icons/icon-192.png",
						"sizes": "192x192",
						"type": "image/png"
					},
					{
						"src": "icons/icon-256x256.png",
						"sizes": "256x256",
						"type": "image/png"
					},
					{
						"src": "icons/icon-384x384.png",
						"sizes": "384x384",
						"type": "image/png"
					},
					{
						"src": "icons/icon-512.png",
						"sizes": "512x512",
						"type": "image/png",
						purpose: 'any',
					},
					{
						"src": "icons/maskable-icon-512.png",
						"sizes": "512x512",
						"type": "image/png",
						"purpose": "maskable"
					  }
				]
			},
			injectManifest: {
				globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,woff,woff2}']
			},
			workbox: {
				globPatterns: [
					'client/**/*.{js,css,ico,png,svg,txt,webp,webmanifest}',
					'prerendered/**/*.html'
				]
			},
			devOptions: {
				enabled: process.env.SW_DEV === 'true',
				suppressWarnings: process.env.SUPPRESS_WARNING === 'true',
				type: 'module',
				navigateFallback: '/index.html',
			},
			kit: {
				includeVersionFile: true
			}
		}),
		//VitePWA({ registerType: 'autoUpdate' })
	],
	// test: {
	// 	include: ['src/**/*.{test,spec}.{js,ts}']
	// }
});

export default config;
