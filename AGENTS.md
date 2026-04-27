# Cashier

Cashier is a mobile assistant for Beancount personal finance management.
It is implemented as a PWA using Svelte and DaisyUI frameworks.

## Projects

- Project plans are stored in `/docs/projects` folder.

## Usage Scenarios

The most common scenarios:

### Mobile App

- Quick balance check.
- Transaction entry.

#### Desktop App

- More detailed review, analysis, reports.
- Moving transactions from cashier.bean into an appropriate file.

## Architecture

- The app is a PWA with a single page application (SPA) architecture.
- The app is built using Svelte and DaisyUI frameworks.
- It is deployed as a static website to Netlify (`npm run deploy`).
- The ledger is stored in OPFS, in Beancount files. Some data is in IndexedDb.
- The configuration information is in Settinsg table in IndexedDb.
- The app uses File System API to access full ledger in supported browsers.

### Rust Ledger WASM

- `ledgerService` is the light version, loading only the Transactions. It provides the LSP features and is used for saving the Xact record to a correct place in the source file.
- `fullLedgerService` loads the complete book, with all files, and is used to run financial reports and queries.
- `ledgerWorkerClient` is the interface to the fullLedgerService, running in a Worker and handling data in the background.
- Individual pages send queries and use the returned data asynchronously.

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

- Assume the local dev server is running at `http://localhost:5173/`. It is started and managed by the user.

## Tools

- `npm` is the package manager.
- Use ripgrep (`rg`) CLI for fast text search across text files.n
- Use `agent-browser` CLI to run the browser.
- **Formatting**: `oxfmt` (with Prettier as fallback for `.svelte` files via `prettier-plugin-svelte`).
- **Linting**: `oxlint` for JS/TS; `eslint-plugin-svelte` via ESLint for Svelte templates.
- **Unit tests**: Vitest — `npm run test:unit`
- **E2E tests**: Playwright — `npm run test:e2e`
- Run `npm run format` to format, `npm run lint` to lint.
- Use Serena MCP for codebase navigation.

### Code Intelligence (LSP)

Prefer LSP over Grep/Glob/Read for code navigation:

- `goToDefinition` / `goToImplementation` to jump to source
- `findReferences` to see all usages across the codebase
- `workspaceSymbol` to find where something is defined
- `documentSymbol` to list all symbols in a file
- `hover` for type info without reading the file

Before renaming or changing a function signature, use `findReferences` to find all call sites first.
Use Grep/Glob only for text/pattern searches (comments, strings, config values) where LSP doesn't help.
After writing or editing code, check LSP diagnostics before moving on. Fix any type errors or missing imports immediately.
