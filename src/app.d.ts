// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces

import 'vite-plugin-pwa/info';
import 'vite-plugin-pwa/svelte';
import 'vite-plugin-pwa/pwa-assets';

declare global {
	declare namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}
}

export {};
