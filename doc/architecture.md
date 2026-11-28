# Architecture

The decisions made in the architecture of the app.

## Overview

- PWA / single-page app built with SvelteKit and DaisyUI, deployed as a static site to Cloudflare Workers static assets (`npm run deploy`), alongside a small Worker (`worker/`) that serves `/api/*` (see [Price Fetching Proxy](#price-fetching-proxy)).
- **Svelte 5** with runes (`$state`, `$derived`, `$effect`) — do NOT use Svelte 4 stores or `$:` reactive patterns.
- **TailwindCSS v4** and **DaisyUI v5** — class names and config differ from earlier versions.
- Ledger files are stored in OPFS, in Beancount format, accessed via the File System API. App data and settings are in IndexedDB (via **Dexie**).
- Transactions entered on the device (the _working set_) are not a file: they live in a Yjs (CRDT) document persisted in IndexedDB. See [Working Set Store](#working-set-store). Scheduled transactions are in a second, separate Yjs document ([Scheduled Transactions Store](#scheduled-transactions-store)).

### Rust Ledger WASM

- `ledgerWorkerClient` (`src/lib/services/`, imported as `fullLedgerService`) loads the complete book in a background Worker and is used to run reports and queries. It reads all `.bean` files from OPFS and is also handed the working set as Beancount text (`CrdtXactStore.toBeancount()`).
- The working set is registered in the worker's file map under a _virtual_ filename, `DEVICE_XACTS_FILE` (`src/lib/constants.ts`, value `cashier.bean`). It is never a real file in OPFS; a real file of that name would be overridden.
- If the user has configured their own book file, that file is the WASM parse entry point, with the virtual working-set file folded in via an `include` line injected in memory (never written to disk). This keeps `option` directives in the user's book authoritative — rledger only honors options in the entry-point file. With no user book configured, the virtual working-set file is the entry point on its own.
- Pages send queries and use the returned data asynchronously.

### Key directories

- `src/lib/components/` — shared UI components
- `src/lib/data/` — data access layer (Dexie, models)
- `src/lib/services/` — business logic: app/accounts/backup services, ledger worker client, S3/WebDAV sync and backup, price providers (`prices/`)
- `src/lib/storage/` — OPFS backend and the CRDT stores (working set, scheduled transactions)
- `src/lib/sync/` — peer sync, delta sync, device identity/pairing/trust
- `src/lib/stores/` — Svelte stores (reactive state)
- `src/lib/rledger/` — Rust Ledger WASM integration
- `src/lib/workers/` — background web workers (ledger worker)
- `src/lib/assetAllocation/`, `portfolioReturns/`, `taxReport/`, `reconciliation/`, `importers/` — feature domains
- `src/lib/demo/` — demo data fixtures and loader
- `src/lib/utils/` — utility functions
- `src/routes/` — SvelteKit file-based routes (~110 pages)
- `worker/` — Cloudflare Worker (CORS proxy)

## Transaction List Ordering

Any UI that lists transactions (device journal, Full Journal, account registers,
etc.) follows one convention: **ascending by date, oldest first, newest last** —
like a chat log, not a feed. On load the list scrolls to the bottom so the most
recent transaction is visible; older history is revealed by scrolling _up_.

- Any BQL query backing such a list sorts `ORDER BY date DESC` (newest-first
  makes the initial page cheap), then the result is reversed before rendering.
- Paginate **backwards in time from the newest end** with keyset/cursor
  pagination (`ledger/journal/+page.svelte`:
  `WHERE (date < :d) OR (date = :d AND id < :id)`), not `OFFSET` — the BQL
  engine only guarantees `WHERE` + `ORDER BY` + `LIMIT`. Load more when the
  user scrolls to the _top_ and prepend; never load more at the bottom.
- A query's `LIMIT` counts rows (one per posting), not transactions, so a batch's
  last transaction group may be cut off mid-posting. Treat the batch as complete
  only if it came back shorter than the limit; otherwise drop that group and use
  it as the boundary for the next page.
- When prepending, restore `scrollTop` by the height delta so the viewport
  doesn't jump.

Don't reintroduce newest-first-at-top for a transaction list — it was tried for
the Full Journal and reverted as inconsistent with the device journal.

## UI Conventions

- **Page width:** constrain the top-level content wrapper to `max-w-2xl mx-auto`
  so layouts stay readable on desktop and natural on mobile.
- **Toggles:** DaisyUI's `.toggle` renders a light track regardless of dark
  theme. Always add `bg-transparent bg-none`:

  ```svelte
  <input type="checkbox" class="toggle toggle-success bg-transparent bg-none" bind:checked={value} />
  ```

  See `ScheduleEditor.svelte` and `src/routes/sync/peer/+page.svelte`.

- **Toolbar overflow menu:** `Toolbar.svelte` takes an optional `menuItems`
  snippet; when given, it shows a kebab (`⋮`) dropdown. Use it for page-specific
  actions that don't merit a permanent toolbar icon. Define the snippet at the
  top level of the page (not inside `<main>`) and pass it by shorthand:

  ```svelte
  {#snippet menuItems()}
    <ToolbarMenuItem text="Refresh" Icon={RefreshCcwIcon} onclick={loadEntries} />
  {/snippet}

  <main>
    <Toolbar title="My Page" {menuItems}>…</Toolbar>
  </main>
  ```

  `ToolbarMenuItem` supports `text`, `Icon`, `disabled`, `onclick`, and
  `targetNav` (navigates via `goto` before calling `onclick`). Examples:
  `src/routes/sync/beancount/+page.svelte`,
  `src/routes/sync/filesystem/+page.svelte`.

## Working Set Store

The device's working set — transactions entered on this device, not yet archived
into the user's book — is a CRDT store, `CrdtXactStore`
(`src/lib/storage/crdtXactStore.ts`): a Yjs document persisted to IndexedDB via
`y-indexeddb`, built on the shared `CrdtDocStore` base (`crdtDocStore.ts`).
There is no `cashier.bean` file in OPFS.

Consumers (editor, journal, search, ledger loader, peer sync, backup) never
create the store themselves. They call `getXactStore()`
(`src/lib/storage/xactStoreRegistry.ts`), which creates it on first use and
returns the same instance afterwards. `subscribeXactStore(callback)` fires on
every change, whatever the cause: local edit, merge from another device, or
clear. `setXactStore()` replaces the instance in tests. The store is imported on
demand, which also avoids an import cycle (`crdtXactStore` →
`webdavAutoBackupService` → registry).

- Each transaction is one record with a stable, monotonic ULID (`XactId`),
  stored as a plain JSON value in a `Y.Map`. IDs stay valid across edits.
- Concurrent edits of the _same_ transaction resolve last-writer-wins per record;
  adds and removes of _different_ transactions merge cleanly, so devices can
  enter transactions independently and converge without manual merging.
- Each record remembers the ID of the device that created it (`origin`).
- The store is initialized once its IndexedDB database exists
  (`isInitialized()`); onboarding calls `appService.initializeXactStore()`.

### Sync and backup

Merging is idempotent and order-independent, so any sync path can be repeated
safely. Transaction origins keep updates from echoing: `remote` (from a peer,
`REMOTE_ORIGIN`) is not sent back; `bucket` (from remote storage,
`BUCKET_ORIGIN`) is not uploaded again.

- **Peer sync** (`sync/peerConnection.svelte.ts`) exchanges Yjs updates directly
  between trusted devices and pushes local edits live while connected.
- **Delta sync through remote storage** (`sync/deltaSync.ts`) is shared by S3 and
  WebDAV, which supply only a small object-store adapter
  (`services/s3RemoteStore.ts`, `services/webdavRemoteStore.ts`). A device
  uploads just the changes since its last upload as numbered delta files of its
  own; others apply the deltas they lack, in order. A snapshot of the whole
  document plus per-device acknowledgements let any device compact: fold deltas
  into a snapshot and delete those everybody has. When the working set is emptied
  and every trusted device has applied the deletions, the document is reset to
  drop its history. S3 is always encrypted; WebDAV optionally
  (`services/webdavEncryption.ts`). Only trusted devices are merged. Design:
  `doc/completed-projects/2026-10-16_delta-sync.md`.
- **WebDAV sync** (`services/webdavAutoBackupService.ts`, which is the automatic upload, and `webdavDelta.ts`)
  uploads after each write, debounced, using delta sync.
- **Shared settings in sync** (`services/backup/sharedSettings.ts`): S3, WebDAV
  and Peer Sync send, show and import settings only through it, so secrets stay
  on the device. What a backup does with each setting is declared in
  `services/backup/rules.ts`.
- **Backup file** (`services/backup/`,
  `restoredDevice.ts`) is versioned, gzipped JSON in four groups: shared settings,
  transactions (working set and scheduled transactions, both as Yjs state), this
  device (portable device settings and trusted devices) and credentials. Secrets
  are blanked in the plain groups; the credentials group holds each connection
  whole, encrypted. A restore creates a new device identity;
  on a device that has never synced, the backed-up device's ID becomes
  `previousDeviceId`. The transaction stores are only ever merged into. Design:
  `doc/backup.md`; each format version has its own reader in `backup/readers/`.

### How the working set reaches the WASM engine

The store is not a file, so `ledgerWorkerClient` calls
`getXactStore().toBeancount()` and passes the text with the load request
(`workingSetSource`). The worker registers it under the virtual
`DEVICE_XACTS_FILE` name and either makes it the entry point or folds it into
the user's book (see [Rust Ledger WASM](#rust-ledger-wasm)). A hash of the text
is kept next to the ledger cache, so the cache is rebuilt when the working set
changes even though no file modification time did.

Do not read or write a `cashier.bean` in OPFS: it is not the working set, and any
real file of that name is ignored when the ledger loads.

### Reloading after a mutation

Any code path that writes to the working set (append/edit/delete, delete-all,
import, sync) must keep two things up to date:

1. **Device transaction lists** — pages that list device transactions (e.g.
   `src/routes/journal/+page.svelte`) use
   `$effect(() => subscribeXactStore(load))`, so they refresh themselves,
   including for changes from other devices.
2. **Full ledger + change indicator** — call `void reloadLedgerFromOpfs()`
   (`src/lib/services/ledgerReload.ts`, fire-and-forget) after the write. It
   invalidates `fullLedgerService` so the working set is folded in again, and
   rebases the OPFS staleness snapshot so the homepage "modified" indicator
   doesn't stay stuck. Peer sync does this itself after a merge (unless
   auto-reload is off); the WebDAV page offers a **Reload Ledger** button after a
   download.

Reference pattern: `src/routes/tx/+page.svelte` (`saveXact`),
`src/routes/xact-actions/+page.svelte` (`onDeleteConfirmed`, `onDuplicateClick`),
and `src/routes/journal/+page.svelte` (`onDeleteAllConfirmed`, for `clear()`).

## Scheduled Transactions Store

Scheduled transactions are kept in their own Yjs document, `CrdtScxStore`
(`src/lib/storage/crdtScxStore.ts`), separate from the working set (which is
cleared once its transactions are archived) and persisted to its own IndexedDB
database. It follows the same pattern as the working set: shared `CrdtDocStore`
base, stable record IDs, `getScxStore()` / `subscribeScxStore()` /
`setScxStore()` in `scxStoreRegistry.ts`, and merge/sync through the same
mechanisms. Business logic is in `services/scxService.ts`.

## Price Fetching Proxy

Price providers need a CORS-free path to their sources. A Cloudflare Worker
(`worker/index.ts`, `worker/proxy.ts`) serves `GET /api/proxy?url=<https URL>`,
same-origin with the app (`run_worker_first: ["/api/*"]` in `wrangler.jsonc`). It
only fetches hosts in the static `ALLOWED_HOSTS` allowlist (add a provider's host
there) and requires the `PROXY_KEY` secret. Client side:
`src/lib/services/prices/proxyFetch.ts` — the proxy base URL and key come from
the device-only `proxy` setting, `{ url, key }` (Settings → Device Settings →
HTTP Proxy); an empty URL falls back to the same-origin `/api/proxy`. Design:
`doc/completed-projects/2026-11-16_CORS-proxy.md`.
