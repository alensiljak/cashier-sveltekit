# Cashier

Cashier is a mobile assistant for Beancount personal finance management.
It is implemented as a PWA using Svelte and DaisyUI frameworks.

## Projects

- Project plans are stored in `/docs/projects` folder.

## Architecture

- The app is a PWA with a single page application (SPA) architecture.
- The app is built using Svelte and DaisyUI frameworks.
- The app is deployed as a static website to Netlify (`npm run deploy`).
- The app's data is stored in OPFS. Previously it was in IndexedDb and some data is still cached there. To be moved to files in OPFS.
- The configuration information is in IndexedDb.
- The app uses File System API to access full ledger.
- Synchronization retrieves data from filesystem and stores it in OPFS and IndexedDb.

### Key directories

- `src/lib/components/` — shared UI components
- `src/lib/data/` — data access layer
- `src/lib/services/` — business logic services
- `src/lib/storage/` — OPFS and IndexedDb storage abstractions
- `src/lib/stores/` — Svelte stores (reactive state)
- `src/lib/sync/` — synchronization logic
- `src/lib/rledger/` — Rust Ledger WASM integration
- `src/lib/utils/` — utility functions
- `src/routes/` — SvelteKit file-based routes (~30+ pages)

## Dev Server

- Assume the local dev server is running at `http://localhost:5173/`. It is started by the user.

## Tools

- Use ripgrep (`rg`) CLI for fast text search across text files.n
- Use `sd` (sed alternative) for fast text replace in text files.
- Use `agent-browser` CLI to run the browser.
- **Formatting**: `oxfmt` (with Prettier as fallback for `.svelte` files via `prettier-plugin-svelte`).
- **Linting**: `oxlint` for JS/TS; `eslint-plugin-svelte` via ESLint for Svelte templates.
- **Unit tests**: Vitest — `npm run test:unit`
- **E2E tests**: Playwright — `npm run test:e2e`
- Run `npm run format` to format, `npm run lint` to lint.
- Use Serena MCP for codebase navigation.

## Rust Ledger WASM

- Use `Ledger` for multi-file parsing, caching, and querying.
- `ParsedLedger` is used for single-file only or a concatenated Beancount string.

```js
const ledger = Ledger.fromFiles({filemap}, "mainfile.bean");
const costBasis = ledger.query("SELECT cost(sum(position)) ...");
```

### Code Intelligence

Prefer LSP over Grep/Glob/Read for code navigation:

- `goToDefinition` / `goToImplementation` to jump to source
- `findReferences` to see all usages across the codebase
- `workspaceSymbol` to find where something is defined
- `documentSymbol` to list all symbols in a file
- `hover` for type info without reading the file

Before renaming or changing a function signature, use `findReferences` to find all call sites first.
Use Grep/Glob only for text/pattern searches (comments, strings, config values) where LSP doesn't help.
After writing or editing code, check LSP diagnostics before moving on. Fix any type errors or missing imports immediately.
