import svelte from 'eslint-plugin-svelte';
import tsParser from '@typescript-eslint/parser';

// Note: JS/TS linting is handled by oxlint (see package.json lint script).
// This ESLint config only covers Svelte template linting via eslint-plugin-svelte.

export default [
	{
		ignores: [
			'build/',
			'coverage/',
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
				parser: tsParser,
				extraFileExtensions: ['.svelte']
			}
		},
		rules: {
			// The @lucide/svelte barrel re-exports ~1700 icons and forces all of them to load
			// (slow dev reloads and tests). Use deep imports: '@lucide/svelte/icons/<name>'.
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: '@lucide/svelte',
							message: "Use a deep import, e.g. import X from '@lucide/svelte/icons/x'."
						}
					]
				}
			],
			// No `paths.base` is configured, so resolve() would be a no-op on every link.
			'svelte/no-navigation-without-resolve': 'off',
			// Flags local, short-lived Map/Set/Date instances that never need to be reactive.
			'svelte/prefer-svelte-reactivity': 'off',
			// Lists are display-only and replaced wholesale; a non-unique value key would throw
			// at runtime, and an index key adds nothing over the default unkeyed behaviour.
			'svelte/require-each-key': 'off'
		}
	}
];
