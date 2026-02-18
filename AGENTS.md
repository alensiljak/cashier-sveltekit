# Cashier

Cashier is a mobile assistant for Beancount personal finance management.

It is implemented as a PWA application using Svelte and DaisyUI frameworks.

## Styling

The application styling has recently been migrated from Skeleton v3 to DaisyUI and not all the visual aspects may have been migrated correctly.

## Dev Server

Assume the local dev server is running at `http://localhost:5173/`.
The user will maintain this.

## Tooling

- **Formatting**: `oxfmt` (with Prettier as fallback for `.svelte` files via `prettier-plugin-svelte`)
- **Linting**: `oxlint` for JS/TS; `eslint-plugin-svelte` via ESLint for Svelte templates
- Run `npm run format` to format, `npm run lint` to lint
