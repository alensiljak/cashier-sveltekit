import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';
import { skeleton } from '@skeletonlabs/tw-plugin';
import daisyui from 'daisyui';

/** @type {import('tailwindcss').Config} */
export default {
	darkMode: 'class',
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {},
	},
	plugins: [
		forms,
		typography,
		skeleton({
			themes: {
				preset: [
					{
						name: 'skeleton',
						enhancements: true,
					},
				],
			},
		}),
		daisyui,
	],
	daisyui: {
		themes: [
			{
				cashier: {
					"primary": "oklch(45.53% 0.08 191.14deg)",
					"secondary": "oklch(42.41% 0.16 29.44deg)",
					"accent": "oklch(88.68% 0.18 95.32deg)",
					"neutral": "oklch(23.76% 0 228.89deg)",
					"base-100": "oklch(89.78% 0 287.22deg)",
					"info": "oklch(45.53% 0.08 191.14deg)",
					"success": "oklch(45.53% 0.08 191.14deg)",
					"warning": "oklch(88.68% 0.18 95.32deg)",
					"error": "oklch(42.41% 0.16 29.44deg)",
				},
			},
		],
	},
};