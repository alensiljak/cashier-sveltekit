import { join } from 'path';
import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';
import { myCustomTheme } from './cashier-theme.ts'
// import { cashierTheme } from './cashier-theme-v3.ts';

// 1. Import the Skeleton plugin
import { skeleton } from '@skeletonlabs/tw-plugin';
// import { skeleton, contentPath } from '@skeletonlabs/skeleton/plugin';
// import * as themes from '@skeletonlabs/skeleton/themes';

const config = {
	// 2. Opt for dark mode to be handled via the class method
	darkMode: 'class',
	content: [
		'./src/**/*.{html,js,svelte,ts}',
		// 3. Append the path to the Skeleton package
		join(require.resolve(
			'@skeletonlabs/skeleton'),
			'../**/*.{html,js,svelte,ts}'
		)
		// contentPath(import.meta.url, 'svelte')
	],
	theme: {
		extend: {}
	},
	plugins: [
		// require('@tailwindcss/typography'),
		typography,
		forms,
		// 4. Append the Skeleton plugin (after other plugins)
		skeleton({
			// NOTE: each theme included will be added to your CSS bundle
			themes: { 
				//preset: ['gold-nouveau'] 
				custom: [ myCustomTheme ]
				// custom: [ cashierTheme ]
			}
			//[ 
			// themes.nouveau,
			//themes.cerberus, themes.rose 
			//	]
		})
	]
} satisfies Config;

export default config;