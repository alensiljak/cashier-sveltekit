import { sveltekit } from '@sveltejs/kit/vite';
//import { VitePWA } from 'vite-plugin-pwa'
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

/** @type {import('vite').UserConfig} */
const config = {
	plugins: [
		sveltekit(),
		// SvelteKitPWA({ /* pwa options */ }),
		// VitePWA({
		SvelteKitPWA({
			registerType: 'prompt',
			injectRegister: null,
			manifest: {
				"name": "Cashier",
				"short_name": "cashier",
				"theme_color": "#076461",
				"background_color": "#000000",
				display: 'standalone',
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
						"src": "icons/favicon-128x128.png",
						"sizes": "128x128",
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
						purpose: 'any maskable',
					}
				]
			}
		}),
		//VitePWA({ registerType: 'autoUpdate' })
	],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
};

export default config;
