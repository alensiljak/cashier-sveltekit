import { sveltekit } from '@sveltejs/kit/vite';
// import { VitePWA } from 'vite-plugin-pwa'

/** @type {import('vite').UserConfig} */
const config = {
	plugins: [
		sveltekit(),
		// SvelteKitPWA({ /* pwa options */ }),
		// VitePWA({ registerType: 'prompt'})
	],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
};

export default config;
