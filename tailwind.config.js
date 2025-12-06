/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	plugins: [require('daisyui')],
	daisyui: {
		themes: [
			{
				cashiertheme: {
					'primary': '#076461',
					'secondary': '#92140c',
					'accent': '#ffd700',
					'neutral': '#1d1f20',
					'base-100': '#ffffff',
					'info': '#519390',
					'success': '#076461',
					'warning': '#ffd700',
					'error': '#92140c',
				}
			},
			{
				cashierthemedark: {
					'primary': '#076461',
					'secondary': '#92140c',
					'accent': '#ffd700',
					'neutral': '#2a2e37',
					'base-100': '#1d2025',
					'base-200': '#25282d',
					'base-300': '#2e3238',
					'base-content': '#e6e6e6',
					'info': '#519390',
					'success': '#076461',
					'warning': '#ffd700',
					'error': '#92140c',
				}
			},
			'dark',
			'light'
		],
	},
	darkMode: 'class', // Enable dark mode based on the presence of 'dark' class
	theme: {
		extend: {
			borderRadius: {
				'lg': '8px',
				'xl': '8px'
			}
		}
	}
};