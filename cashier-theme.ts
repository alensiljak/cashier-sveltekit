/*
	Theme for Skeleton v2.
*/

import type { CustomThemeConfig } from '@skeletonlabs/tw-plugin';

export const myCustomTheme: CustomThemeConfig = {
	name: 'my-custom-theme',
	properties: {
		// =~= Theme Properties =~=
		'--theme-font-family-base': `system-ui`,
		'--theme-font-family-heading': `system-ui`,
		'--theme-font-color-base': 'var(--color-tertiary-200)',
		'--theme-font-color-dark': 'var(--color-tertiary-200)',
		'--theme-rounded-base': '8px',
		'--theme-rounded-container': '8px',
		'--theme-border-base': '1px',
		// =~= Theme On-X Colors =~=
		'--on-primary': 'var(--color-tertiary-200)',
		'--on-secondary': 'var(--color-tertiary-200)',
		'--on-tertiary': 'var(--color-surface-900)',
		'--on-success': 'var(--color-tertiary-200)',
		'--on-warning': 'var(--color-surface-900)',
		'--on-error': 'var(--color-tertiary-200)',
		'--on-surface': 'var(--color-tertiary-200)',
		// =~= Theme Colors  =~=
		// primary | #076461
		'--color-primary-50': '218 232 231', // #dae8e7
		'--color-primary-100': '205 224 223', // #cde0df
		'--color-primary-200': '193 216 216', // #c1d8d8
		'--color-primary-300': '156 193 192', // #9cc1c0
		'--color-primary-400': '81 147 144', // #519390
		'--color-primary-500': '7 100 97', // #076461
		'--color-primary-600': '6 90 87', // #065a57
		'--color-primary-700': '5 75 73', // #054b49
		'--color-primary-800': '4 60 58', // #043c3a
		'--color-primary-900': '3 49 48', // #033130
		// secondary | #92140c
		'--color-secondary-50': '239 220 219', // #efdcdb
		'--color-secondary-100': '233 208 206', // #e9d0ce
		'--color-secondary-200': '228 196 194', // #e4c4c2
		'--color-secondary-300': '211 161 158', // #d3a19e
		'--color-secondary-400': '179 91 85', // #b35b55
		'--color-secondary-500': '146 20 12', // #92140c
		'--color-secondary-600': '131 18 11', // #83120b
		'--color-secondary-700': '110 15 9', // #6e0f09
		'--color-secondary-800': '88 12 7', // #580c07
		'--color-secondary-900': '72 10 6', // #480a06
		// tertiary | #ffd700
		'--color-tertiary-50': '255 249 217', // #fff9d9
		'--color-tertiary-100': '255 247 204', // #fff7cc
		'--color-tertiary-200': '255 245 191', // #fff5bf
		'--color-tertiary-300': '255 239 153', // #ffef99
		'--color-tertiary-400': '255 227 77', // #ffe34d
		'--color-tertiary-500': '255 215 0', // #ffd700
		'--color-tertiary-600': '230 194 0', // #e6c200
		'--color-tertiary-700': '191 161 0', // #bfa100
		'--color-tertiary-800': '153 129 0', // #998100
		'--color-tertiary-900': '125 105 0', // #7d6900
		// success | #076461
		'--color-success-50': '218 232 231', // #dae8e7
		'--color-success-100': '205 224 223', // #cde0df
		'--color-success-200': '193 216 216', // #c1d8d8
		'--color-success-300': '156 193 192', // #9cc1c0
		'--color-success-400': '81 147 144', // #519390
		'--color-success-500': '7 100 97', // #076461
		'--color-success-600': '6 90 87', // #065a57
		'--color-success-700': '5 75 73', // #054b49
		'--color-success-800': '4 60 58', // #043c3a
		'--color-success-900': '3 49 48', // #033130
		// warning | #ffd700
		'--color-warning-50': '255 249 217', // #fff9d9
		'--color-warning-100': '255 247 204', // #fff7cc
		'--color-warning-200': '255 245 191', // #fff5bf
		'--color-warning-300': '255 239 153', // #ffef99
		'--color-warning-400': '255 227 77', // #ffe34d
		'--color-warning-500': '255 215 0', // #ffd700
		'--color-warning-600': '230 194 0', // #e6c200
		'--color-warning-700': '191 161 0', // #bfa100
		'--color-warning-800': '153 129 0', // #998100
		'--color-warning-900': '125 105 0', // #7d6900
		// error | #92140c
		'--color-error-50': '239 220 219', // #efdcdb
		'--color-error-100': '233 208 206', // #e9d0ce
		'--color-error-200': '228 196 194', // #e4c4c2
		'--color-error-300': '211 161 158', // #d3a19e
		'--color-error-400': '179 91 85', // #b35b55
		'--color-error-500': '146 20 12', // #92140c
		'--color-error-600': '131 18 11', // #83120b
		'--color-error-700': '110 15 9', // #6e0f09
		'--color-error-800': '88 12 7', // #580c07
		'--color-error-900': '72 10 6', // #480a06
		// surface | #1d1f20
		'--color-surface-50': '221 221 222', // #ddddde
		'--color-surface-100': '210 210 210', // #d2d2d2
		'--color-surface-200': '199 199 199', // #c7c7c7
		'--color-surface-300': '165 165 166', // #a5a5a6
		'--color-surface-400': '97 98 99', // #616263
		'--color-surface-500': '29 31 32', // #1d1f20
		'--color-surface-600': '26 28 29', // #1a1c1d
		'--color-surface-700': '22 23 24', // #161718
		'--color-surface-800': '17 19 19', // #111313
		'--color-surface-900': '14 15 16' // #0e0f10
	}
};
