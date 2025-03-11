import { join } from 'path';
import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';
import { myCustomTheme } from './cashier-theme.ts'

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
	]
} satisfies Config;

export default config;