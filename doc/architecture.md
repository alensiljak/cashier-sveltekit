# Architecture

The decisions made in the architecture of the app.

## Overview

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

## Page Width

Page content is constrained to `max-w-2xl mx-auto` (centered, ~42rem) so that
layouts stay readable on wide/desktop viewports while remaining natural on
mobile. Apply this to the top-level content wrapper of a page's markup.
