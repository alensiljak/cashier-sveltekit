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
			'dark',
			'light'
		],
	},
	theme: {
		extend: {
			borderRadius: {
				'lg': '8px',
				'xl': '8px'
			}
		}
	}
};