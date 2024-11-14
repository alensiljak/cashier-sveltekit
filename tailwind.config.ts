import type { Config } from 'tailwindcss';

// 1. Import the Skeleton plugin
import { skeleton, contentPath } from '@skeletonlabs/skeleton/plugin';
import * as themes from '@skeletonlabs/skeleton/themes';

const config = {
	// 2. Opt for dark mode to be handled via the class method
	darkMode: 'class',
	content: [
		'./src/**/*.{html,js,svelte,ts}',
		// 3. Append the path to the Skeleton package
		contentPath(import.meta.url, 'svelte')
	],
	theme: {
		extend: {}
	},
	plugins: [
		require('@tailwindcss/typography'),
		// 4. Append the Skeleton plugin (after other plugins)
		skeleton({
			// NOTE: each theme included will be added to your CSS bundle
            themes: [ 
				themes.nouveau,
				//themes.cerberus, themes.rose 
				]
		})
	]
} satisfies Config;

export default config;