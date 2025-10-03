/// <reference types="@sveltejs/kit" />

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
import 'vite-plugin-pwa/info';
import 'vite-plugin-pwa/svelte';
import 'vite-plugin-pwa/pwa-assets';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}
}

// Declare the build date global variable
declare const __BUILD_DATE__: string;

export {};