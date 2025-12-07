/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	plugins: [require('daisyui')],
	daisyui: {
		themes: true // Enable theme system - themes are defined in CSS file
	},
	darkMode: 'class', // Enable dark mode based on the presence of 'dark' class
	theme: {
		extend: {
			borderRadius: {
				lg: '8px',
				xl: '8px'
			},
			// colors: {
			// 	'my-primary': {
			// 		50: 'oklch(0.959 0.06 192.33)',
			// 		200: 'oklch(0.828 0.139 190.76)'
			// 	}
			// }
		}
	}
};
