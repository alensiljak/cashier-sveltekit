/*
	Theme for use with Skeleton v3.
*/
import type { Theme } from '@skeletonlabs/skeleton/themes';

const cashierTheme = {
  "name": "cashier-theme",
  "properties": {
    "--type-scale-factor": "1.067",
    "--type-scale-1": "calc(0.75rem * var(--type-scale-factor))",
    "--type-scale-2": "calc(0.875rem * var(--type-scale-factor))",
    "--type-scale-3": "calc(1rem * var(--type-scale-factor))",
    "--type-scale-4": "calc(1.125rem * var(--type-scale-factor))",
    "--type-scale-5": "calc(1.25rem * var(--type-scale-factor))",
    "--type-scale-6": "calc(1.5rem * var(--type-scale-factor))",
    "--type-scale-7": "calc(1.875rem * var(--type-scale-factor))",
    "--type-scale-8": "calc(2.25rem * var(--type-scale-factor))",
    "--type-scale-9": "calc(3rem * var(--type-scale-factor))",
    "--type-scale-10": "calc(3.75rem * var(--type-scale-factor))",
    "--type-scale-11": "calc(4.5rem * var(--type-scale-factor))",
    "--type-scale-12": "calc(6rem * var(--type-scale-factor))",
    "--type-scale-13": "calc(8rem * var(--type-scale-factor))",
    "--base-font-color": "var(--color-surface-950)",
    "--base-font-color-dark": "var(--color-surface-50)",
    "--base-font-family": "system-ui",
    "--base-font-size": "inherit",
    "--base-line-height": "inherit",
    "--base-font-weight": "normal",
    "--base-font-style": "normal",
    "--base-letter-spacing": "0em",
    "--heading-font-color": "inherit",
    "--heading-font-color-dark": "inherit",
    "--heading-font-family": "inherit",
    "--heading-font-weight": "bold",
    "--heading-font-style": "normal",
    "--heading-letter-spacing": "inherit",
    "--anchor-font-color": "var(--color-primary-500)",
    "--anchor-font-color-dark": "var(--color-primary-400)",
    "--anchor-font-family": "inherit",
    "--anchor-font-size": "inherit",
    "--anchor-line-height": "inherit",
    "--anchor-font-weight": "inherit",
    "--anchor-font-style": "inherit",
    "--anchor-letter-spacing": "inherit",
    "--anchor-text-decoration": "none",
    "--anchor-text-decoration-hover": "underline",
    "--anchor-text-decoration-active": "none",
    "--anchor-text-decoration-focus": "none",
    "--space-scale-factor": "1",
    "--radii-default": "6px",
    "--radii-container": "6px",
    "--border-width-default": "1px",
    "--divide-width-default": "1px",
    "--outline-width-default": "1px",
    "--ring-width-default": "1px",
    "--body-background-color": "var(--color-surface-50)",
    "--body-background-color-dark": "var(--color-surface-950)",
		// =~= Theme Colors  =~=
		// primary | #076461 
		"--color-primary-50": "218 232 231", // #dae8e7 (should be 8fdcd7?)
		"--color-primary-100": "205 224 223", // #cde0df
		"--color-primary-200": "193 216 216", // #c1d8d8
		"--color-primary-300": "156 193 192", // #9cc1c0
		"--color-primary-400": "81 147 144", // #519390
		"--color-primary-500": "7 100 97", // #076461
		"--color-primary-600": "6 90 87", // #065a57
		"--color-primary-700": "5 75 73", // #054b49
		"--color-primary-800": "4 60 58", // #043c3a
		"--color-primary-900": "3 49 48", // #033130
    "--color-primary-950": "2 46 43", // #022e2b, manual
    "--color-primary-contrast-dark": "var(--color-primary-950)",
    "--color-primary-contrast-light": "var(--color-primary-50)",
    "--color-primary-contrast-50": "var(--color-primary-contrast-dark)",
    "--color-primary-contrast-100": "var(--color-primary-contrast-dark)",
    "--color-primary-contrast-200": "var(--color-primary-contrast-dark)",
    "--color-primary-contrast-300": "var(--color-primary-contrast-dark)",
    "--color-primary-contrast-400": "var(--color-primary-contrast-dark)",
    "--color-primary-contrast-500": "var(--color-primary-contrast-light)",
    "--color-primary-contrast-600": "var(--color-primary-contrast-light)",
    "--color-primary-contrast-700": "var(--color-primary-contrast-light)",
    "--color-primary-contrast-800": "var(--color-primary-contrast-light)",
    "--color-primary-contrast-900": "var(--color-primary-contrast-light)",
    "--color-primary-contrast-950": "var(--color-primary-contrast-light)",
		// secondary | #92140c 
		"--color-secondary-50": "239 220 219", // #efdcdb
		"--color-secondary-100": "233 208 206", // #e9d0ce
		"--color-secondary-200": "228 196 194", // #e4c4c2
		"--color-secondary-300": "211 161 158", // #d3a19e
		"--color-secondary-400": "179 91 85", // #b35b55
		"--color-secondary-500": "146 20 12", // #92140c
		"--color-secondary-600": "131 18 11", // #83120b
		"--color-secondary-700": "110 15 9", // #6e0f09
		"--color-secondary-800": "88 12 7", // #580c07
		"--color-secondary-900": "72 10 6", // #480a06
    "--color-secondary-950": "64 9 5", // #400905, manual
    "--color-secondary-contrast-dark": "var(--color-secondary-950)",
    "--color-secondary-contrast-light": "var(--color-secondary-50)",
    "--color-secondary-contrast-50": "var(--color-secondary-contrast-dark)",
    "--color-secondary-contrast-100": "var(--color-secondary-contrast-dark)",
    "--color-secondary-contrast-200": "var(--color-secondary-contrast-dark)",
    "--color-secondary-contrast-300": "var(--color-secondary-contrast-dark)",
    "--color-secondary-contrast-400": "var(--color-secondary-contrast-light)",
    "--color-secondary-contrast-500": "var(--color-secondary-contrast-light)",
    "--color-secondary-contrast-600": "var(--color-secondary-contrast-light)",
    "--color-secondary-contrast-700": "var(--color-secondary-contrast-light)",
    "--color-secondary-contrast-800": "var(--color-secondary-contrast-light)",
    "--color-secondary-contrast-900": "var(--color-secondary-contrast-light)",
    "--color-secondary-contrast-950": "var(--color-secondary-contrast-light)",
		// tertiary | #ffd700 
		"--color-tertiary-50": "255 249 217", // #fff9d9
		"--color-tertiary-100": "255 247 204", // #fff7cc
		"--color-tertiary-200": "255 245 191", // #fff5bf
		"--color-tertiary-300": "255 239 153", // #ffef99
		"--color-tertiary-400": "255 227 77", // #ffe34d
		"--color-tertiary-500": "255 215 0", // #ffd700
		"--color-tertiary-600": "230 194 0", // #e6c200
		"--color-tertiary-700": "191 161 0", // #bfa100
		"--color-tertiary-800": "153 129 0", // #998100
		"--color-tertiary-900": "125 105 0", // #7d6900
    "--color-tertiary-950": "105 93 0", // #695d00, manual
    "--color-tertiary-contrast-dark": "var(--color-tertiary-950)",
    "--color-tertiary-contrast-light": "var(--color-tertiary-50)",
    "--color-tertiary-contrast-50": "var(--color-tertiary-contrast-dark)",
    "--color-tertiary-contrast-100": "var(--color-tertiary-contrast-dark)",
    "--color-tertiary-contrast-200": "var(--color-tertiary-contrast-dark)",
    "--color-tertiary-contrast-300": "var(--color-tertiary-contrast-light)",
    "--color-tertiary-contrast-400": "var(--color-tertiary-contrast-light)",
    "--color-tertiary-contrast-500": "var(--color-tertiary-contrast-light)",
    "--color-tertiary-contrast-600": "var(--color-tertiary-contrast-light)",
    "--color-tertiary-contrast-700": "var(--color-tertiary-contrast-light)",
    "--color-tertiary-contrast-800": "var(--color-tertiary-contrast-light)",
    "--color-tertiary-contrast-900": "var(--color-tertiary-contrast-light)",
    "--color-tertiary-contrast-950": "var(--color-tertiary-contrast-light)",
    // success
    "--color-success-50": "218 232 231", // #dae8e7 (should be 8fdcd7?)
    "--color-success-100": "205 224 223", // #cde0df
    "--color-success-200": "193 216 216", // #c1d8d8
    "--color-success-300": "156 193 192", // #9cc1c0
    "--color-success-400": "81 147 144", // #519390
    "--color-success-500": "7 100 97", // #076461
    "--color-success-600": "6 90 87", // #065a57
    "--color-success-700": "5 75 73", // #054b49
    "--color-success-800": "4 60 58", // #043c3a
    "--color-success-900": "3 49 48", // #033130
    "--color-success-950": "2 46 43", // #022e2b, manual
    "--color-success-contrast-dark": "var(--color-success-950)",
    "--color-success-contrast-light": "var(--color-success-50)",
    "--color-success-contrast-50": "var(--color-success-contrast-dark)",
    "--color-success-contrast-100": "var(--color-success-contrast-dark)",
    "--color-success-contrast-200": "var(--color-success-contrast-dark)",
    "--color-success-contrast-300": "var(--color-success-contrast-dark)",
    "--color-success-contrast-400": "var(--color-success-contrast-dark)",
    "--color-success-contrast-500": "var(--color-success-contrast-dark)",
    "--color-success-contrast-600": "var(--color-success-contrast-light)",
    "--color-success-contrast-700": "var(--color-success-contrast-light)",
    "--color-success-contrast-800": "var(--color-success-contrast-light)",
    "--color-success-contrast-900": "var(--color-success-contrast-light)",
    "--color-success-contrast-950": "var(--color-success-contrast-light)",
    // warning
    "--color-warning-50": "255 249 217", // #fff9d9
    "--color-warning-100": "255 247 204", // #fff7cc
    "--color-warning-200": "255 245 191", // #fff5bf
    "--color-warning-300": "255 239 153", // #ffef99
    "--color-warning-400": "255 227 77", // #ffe34d
    "--color-warning-500": "255 215 0", // #ffd700
    "--color-warning-600": "230 194 0", // #e6c200
    "--color-warning-700": "191 161 0", // #bfa100
    "--color-warning-800": "153 129 0", // #998100
    "--color-warning-900": "125 105 0", // #7d6900
    "--color-warning-950": "105 93 0", // #695d00, manual
    "--color-warning-contrast-dark": "var(--color-warning-950)",
    "--color-warning-contrast-light": "var(--color-warning-50)",
    "--color-warning-contrast-50": "var(--color-warning-contrast-dark)",
    "--color-warning-contrast-100": "var(--color-warning-contrast-dark)",
    "--color-warning-contrast-200": "var(--color-warning-contrast-dark)",
    "--color-warning-contrast-300": "var(--color-warning-contrast-dark)",
    "--color-warning-contrast-400": "var(--color-warning-contrast-dark)",
    "--color-warning-contrast-500": "var(--color-warning-contrast-dark)",
    "--color-warning-contrast-600": "var(--color-warning-contrast-light)",
    "--color-warning-contrast-700": "var(--color-warning-contrast-light)",
    "--color-warning-contrast-800": "var(--color-warning-contrast-light)",
    "--color-warning-contrast-900": "var(--color-warning-contrast-light)",
    "--color-warning-contrast-950": "var(--color-warning-contrast-light)",
    // error
    "--color-error-50": "239 220 219", // #efdcdb
    "--color-error-100": "233 208 206", // #e9d0ce
    "--color-error-200": "228 196 194", // #e4c4c2
    "--color-error-300": "211 161 158", // #d3a19e
    "--color-error-400": "179 91 85", // #b35b55
    "--color-error-500": "146 20 12", // #92140c
    "--color-error-600": "131 18 11", // #83120b
    "--color-error-700": "110 15 9", // #6e0f09
    "--color-error-800": "88 12 7", // #580c07
    "--color-error-900": "72 10 6", // #480a06
    "--color-error-950": "64 9 5", // #400905, manual
    "--color-error-contrast-dark": "var(--color-error-950)",
    "--color-error-contrast-light": "var(--color-error-50)",
    "--color-error-contrast-50": "var(--color-error-contrast-dark)",
    "--color-error-contrast-100": "var(--color-error-contrast-dark)",
    "--color-error-contrast-200": "var(--color-error-contrast-dark)",
    "--color-error-contrast-300": "var(--color-error-contrast-dark)",
    "--color-error-contrast-400": "var(--color-error-contrast-dark)",
    "--color-error-contrast-500": "var(--color-error-contrast-light)",
    "--color-error-contrast-600": "var(--color-error-contrast-light)",
    "--color-error-contrast-700": "var(--color-error-contrast-light)",
    "--color-error-contrast-800": "var(--color-error-contrast-light)",
    "--color-error-contrast-900": "var(--color-error-contrast-light)",
    "--color-error-contrast-950": "var(--color-error-contrast-light)",
    // surface
		"--color-surface-50": "221 221 222", // #ddddde
		"--color-surface-100": "210 210 210", // #d2d2d2
		"--color-surface-200": "199 199 199", // #c7c7c7
		"--color-surface-300": "165 165 166", // #a5a5a6
		"--color-surface-400": "97 98 99", // #616263
		"--color-surface-500": "29 31 32", // #1d1f20
		"--color-surface-600": "26 28 29", // #1a1c1d
		"--color-surface-700": "22 23 24", // #161718
		"--color-surface-800": "17 19 19", // #111313
		"--color-surface-900": "14 15 16", // #0e0f10
    "--color-surface-950": "12 13 14", // #0c0d0e, manual
    "--color-surface-contrast-dark": "var(--color-surface-950)",
    "--color-surface-contrast-light": "var(--color-surface-50)",
    "--color-surface-contrast-50": "var(--color-surface-contrast-dark)",
    "--color-surface-contrast-100": "var(--color-surface-contrast-dark)",
    "--color-surface-contrast-200": "var(--color-surface-contrast-dark)",
    "--color-surface-contrast-300": "var(--color-surface-contrast-dark)",
    "--color-surface-contrast-400": "var(--color-surface-contrast-light)",
    "--color-surface-contrast-500": "var(--color-surface-contrast-light)",
    "--color-surface-contrast-600": "var(--color-surface-contrast-light)",
    "--color-surface-contrast-700": "var(--color-surface-contrast-light)",
    "--color-surface-contrast-800": "var(--color-surface-contrast-light)",
    "--color-surface-contrast-900": "var(--color-surface-contrast-light)",
    "--color-surface-contrast-950": "var(--color-surface-contrast-light)"
  },
  "metadata": {
    "version": "3.0.0"
  }
} satisfies Theme;

export default cashierTheme;