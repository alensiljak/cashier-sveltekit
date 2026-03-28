# Cashier

Cashier is a mobile assistant for Beancount personal finance management.
It is implemented as a PWA using Svelte and DaisyUI frameworks.

## Projects

- Project plans are stored in `/docs/projects` folder.

## Dev Server

- Assume the local dev server is running at `http://localhost:5173/`. It is started by the user.

## Tools

- Use ripgrep (`rg`) CLI for fast text search across text files.n
- Use `sd` (sed alternative) for fast text replace in text files.
- Use `agent-browser` CLI to run the browser.
- **Formatting**: `oxfmt` (with Prettier as fallback for `.svelte` files via `prettier-plugin-svelte`).
- **Linting**: `oxlint` for JS/TS; `eslint-plugin-svelte` via ESLint for Svelte templates.
- Run `npm run format` to format, `npm run lint` to lint.
- Use Serena MCP for codebase navigation.
