import svelte from 'eslint-plugin-svelte';
import svelteConfig from './svelte.config.js';
import tseslint from '@typescript-eslint/eslint-plugin';

// Note: JS/TS linting is handled by oxlint (see package.json lint script).
// This ESLint config only covers Svelte template linting via eslint-plugin-svelte.

export default [
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'dist/',
			'node_modules/',
			'package/',
			'.env',
			'.env.*',
			'!.env.example',
			'pnpm-lock.yaml',
			'package-lock.json',
			'yarn.lock'
		]
	},
	...svelte.configs.recommended,
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				extraFileExtensions: ['.svelte'],
				svelteConfig
			}
		}
	},
	tseslint.configs.recommended
];
