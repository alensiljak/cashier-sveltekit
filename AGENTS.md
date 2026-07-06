# Cashier

Cashier is a mobile assistant for Beancount personal finance management.
It is implemented as a PWA using Svelte and DaisyUI frameworks.

## Projects

- Project plans and docs are stored in the `/doc/` folder.
- Completed project docs are in `/doc/completed-projects/`.

## Usage Scenarios

### Mobile App

- balance overview
- quick transaction entry. Stored in `cashier.bean`.
- import/sync Beancount files into local storage (OPFS)

#### Desktop App

- detailed review, analysis, reports
- sorting transactions from `cashier.bean` into appropriate beancount files

## Architecture

- The app is a PWA with a single page application (SPA) architecture, using SvelteKit and DaisyUI frameworks.
- Uses **Svelte 5** with runes syntax (`$state`, `$derived`, `$effect`) — do NOT use Svelte 4 store or `$:` reactive patterns.
- Uses **TailwindCSS v4** and **DaisyUI v5** — class names and config differ from v3/v4 respectively.
- It is deployed as a static website to Netlify (via `npm run deploy`).
- The ledger files are stored in OPFS, in Beancount format. The app data is in IndexedDb (via **Dexie**).
- The configuration information is in Settings table in IndexedDb.
- The app uses File System API to access the ledger files on the device.

### Rust Ledger WASM

- `ledgerService` is the light version, loading only the Transactions. It provides the LSP features and is used for saving the Xact record to a correct place in the source file.
- `ledgerWorkerClient` (imported as `fullLedgerService`) loads the complete book in a background Worker and is used to run financial reports and queries. It reads all `.bean` files from OPFS and injects the user's book include into `cashier.bean` in memory at load time.
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
- `src/lib/assetAllocation/` — asset allocation logic, validation, and sync API client
- `src/lib/workers/` — background web workers (e.g. ledger worker)
- `src/routes/` — SvelteKit file-based routes (~60+ pages)

## Dev Server

- Assume the local dev server is running at `http://localhost:5173/`. It is started and managed by the user.

## Demo Data

- A fresh install/cleared OPFS lands on `/onboarding`. When testing in a browser (e.g. via `agent-browser` against `http://localhost:5173/`), pick **"Try demo data"** there, or go to **Settings → Demo Data → Load demo data** if `cashier.bean` already exists — otherwise every page renders blank and you're not exercising real behavior.
- Demo content (`src/lib/demo/fixtures/*`) is read-only reference data written into `cashier-demo/` in OPFS by `demoDataService.ts`; it is never a substitute for `cashier.bean`, which stays the only file the app writes new transactions to.
- If the demo book is missing an account, commodity, price, or scenario needed to exercise the feature you're testing, do not hand-edit OPFS to patch around it — report the specific gap back so the fixtures in `src/lib/demo/fixtures/` can be extended for future dev and end-user use.

## Tools

- `npm` is the package manager.
- Use ripgrep (`rg`) CLI for fast text search across text files. Prefer over `grep`.
- For running Python code, use `uv run`.
- Use `agent-browser` CLI to run the browser.
- **Formatting**: `oxfmt` (with Prettier as fallback for `.svelte` files via `prettier-plugin-svelte`).
- **Linting**: `oxlint` for JS/TS; `eslint-plugin-svelte` via ESLint for Svelte templates.
- **Unit tests**: Vitest — `npm run test:unit`
- **E2E tests**: Playwright — `npm run test:e2e`
- Run `npm run format` to format, `npm run lint` to lint, `npm run check` to type-check (svelte-check + TypeScript).
- The user runs verification (`npm run verify` — lint, check, unit tests, e2e tests) themselves. Do not run full test suites, lint, or type-check after every edit; only run a narrowly-targeted check (e.g. one test file, `lsp diagnostics` on the file you touched) when you need to verify a specific change, and let the user run `npm run verify` for overall confidence. Remind the user to run the tests if the code change would require the verification.

### Code Intelligence (LSP)

Prefer LSP over grep.
Reserve Grep/Glob for text/pattern searches (comments, strings, config values) where LSP doesn't help.

Before renaming or changing a function signature, find all call sites via LSP first.
After writing or editing code, check diagnostics before moving on. Fix any type errors or missing imports immediately.
