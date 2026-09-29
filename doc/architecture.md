# Architecture

The decisions made in the architecture of the app.

## Overview

- The app is a PWA with a single page application (SPA) architecture, using SvelteKit and DaisyUI frameworks.
- Uses **Svelte 5** with runes syntax (`$state`, `$derived`, `$effect`) — do NOT use Svelte 4 store or `$:` reactive patterns.
- Uses **TailwindCSS v4** and **DaisyUI v5** — class names and config differ from v3/v4 respectively.
- It is deployed as a static website to Netlify (via `npm run deploy`).
- The ledger files are stored in OPFS, in Beancount format. The app data is in IndexedDb (via **Dexie**).
- The transactions entered on the device (the _working set_) are not a file: they live in a Yjs (CRDT) document, persisted in IndexedDb. See [Working Set Store](#working-set-store).
- The configuration information is in Settings table in IndexedDb.
- The app uses File System API to access the ledger files on the device.

### Rust Ledger WASM

- `ledgerWorkerClient` (imported as `fullLedgerService`) loads the complete book in a background Worker and is used to run financial reports and queries. It reads all `.bean` files from OPFS and is also handed the working set as Beancount text (`CrdtXactStore.toBeancount()`).
- The working set is registered in the worker's file map under a _virtual_ filename, `DEVICE_XACTS_FILE` (`src/lib/constants.ts`, value `cashier.bean`). It is never a real file in OPFS; a real file of that name would be overridden.
- If the user has configured their own book file, that file is used as the WASM parse entry point, with the virtual working-set file folded in via an `include` line injected in memory (never written to disk). This keeps `option` directives declared in the user's book authoritative — Beancount/rledger only honors options set in the top-level (entry point) file, ignoring the same option when it appears in an included file. With no user book configured, the virtual working-set file is the entry point on its own.
- Individual pages send queries and use the returned data asynchronously.

### Key directories

- `src/lib/components/` — shared UI components
- `src/lib/data/` — data access layer
- `src/lib/services/` — business logic services
- `src/lib/storage/` — OPFS and IndexedDb storage, including the CRDT working-set store
- `src/lib/stores/` — Svelte stores (reactive state)
- `src/lib/sync/` — synchronization logic
- `src/lib/rledger/` — Rust Ledger WASM integration
- `src/lib/utils/` — utility functions
- `src/lib/assetAllocation/` — asset allocation logic, validation, and sync API client
- `src/lib/workers/` — background web workers (e.g. ledger worker)
- `src/routes/` — SvelteKit file-based routes (~60+ pages)

## Transaction List Ordering

Any UI that lists transactions (device journal, Full Journal, account registers,
etc.) follows the same convention: **ascending by date, oldest first, newest
last** — like a chat log, not a feed. On load the list scrolls to the bottom so
the most recent transaction is immediately visible, and older history is
revealed by scrolling _up_.

Consequences for implementation:

- Any BQL query backing such a list should sort `ORDER BY date DESC` (fetching
  newest-first is what makes an initial page cheap), then the result is
  reversed to ascending before being rendered.
- If the list is paginated, page **forward in time from the newest end**
  (`ledger/journal/+page.svelte` uses keyset/cursor pagination —
  `WHERE (date < :d) OR (date = :d AND id < :id)` — rather than `OFFSET`,
  since the BQL engine only guarantees `WHERE` + `ORDER BY` + `LIMIT`). Load
  more when the user scrolls to the _top_ of what's loaded, and prepend;
  never load more at the bottom.
- A query's `LIMIT` counts rows (one per posting), not transactions, so a
  fetched batch's last transaction group may be cut off mid-posting. Treat it
  as complete only when the batch came back shorter than the requested limit;
  otherwise drop it and use it as the boundary for the next page.
- When prepending older transactions above the current scroll position,
  restore `scrollTop` by the height delta so the viewport doesn't jump.

Don't reintroduce `ORDER BY date DESC` newest-first-at-top for a transaction
list — it was tried for the Full Journal and reverted for being inconsistent
with the device journal and awkward to reconcile with "always show me the
latest transaction on open".

## Page Width

Page content is constrained to `max-w-2xl mx-auto` (centered, ~42rem) so that
layouts stay readable on wide/desktop viewports while remaining natural on
mobile. Apply this to the top-level content wrapper of a page's markup.

## Toggles

DaisyUI's `.toggle` renders a white/light track background by default
regardless of the app's dark theme. Always pair it with `bg-transparent
bg-none` so the track matches the surrounding surface:

```svelte
<input
	type="checkbox"
	class="toggle toggle-success bg-transparent bg-none"
	bind:checked={someValue}
/>
```

See `src/routes/peer-sync/+page.svelte` (Connect toggle) and
`src/lib/components/ScheduleEditor.svelte` (Repayment toggle).

## Working Set Store

The device's working set — the transactions entered on this device, not yet
archived into the user's book — is kept in a CRDT store, `CrdtXactStore`
(`src/lib/storage/crdtXactStore.ts`): a Yjs document persisted to IndexedDB via
`y-indexeddb`. There is no `cashier.bean` file in OPFS.

Consumers (the editor, the journal, search, the ledger loader, peer sync,
backup) never create the store themselves. They call `getXactStore()`
(`src/lib/storage/xactStoreRegistry.ts`), which creates it on first use and
hands out the same instance afterwards. `subscribeXactStore(callback)` runs
`callback` on every change to the store, whatever the cause: a local edit, a
merge from another device, or clear. `setXactStore()` replaces the instance in
tests. The store is imported on demand, which also avoids an import cycle
(`crdtXactStore` → `webdavAutoBackupService` → registry).

- Each transaction is one record with a stable, monotonic ULID (`XactId`),
  stored as a plain JSON value in a `Y.Map`. IDs stay valid across edits.
- Concurrent edits of the _same_ transaction resolve last-writer-wins per
  record; adds and removes of _different_ transactions merge cleanly. Two
  devices can therefore enter transactions independently and converge without
  conflicts or manual merging.
- Each record remembers the ID of the device that created it (`origin`).
- The store is initialized once its IndexedDB database exists
  (`isInitialized()`); onboarding calls `appService.initializeXactStore()`.

### Sync and backup

- **Peer sync** (`src/lib/sync/peerConnection.svelte.ts`) exchanges Yjs updates
  between trusted devices directly, and pushes local edits live while
  connected. Updates merged in from another device carry the `remote` origin
  so they are not echoed back.
- **WebDAV backup** (`webdavAutoBackupService.ts`) uploads the Yjs document
  state to a per-device file, so devices never overwrite each other. Files of
  other trusted devices are merged in on download (`ydocDevices.ts`).
- Merging is idempotent and order-independent, so any sync path can be
  repeated safely.

### How the working set reaches the WASM engine

The store is not a file, so the ledger worker is given its content as text:
`ledgerWorkerClient` calls `getXactStore().toBeancount()` and passes the
result with the load request (`workingSetSource`). The worker registers it in
the file map under the virtual `DEVICE_XACTS_FILE` name and either makes it
the entry point or folds it into the user's book (see
[Rust Ledger WASM](#rust-ledger-wasm)). A hash of the text is kept next to the
ledger cache, so the cache is rebuilt when the working set changes even though
no file modification time changed.

Do not read or write a `cashier.bean` in OPFS. It is not the working set, and
any real file of that name is ignored when the ledger loads.

## Reloading After a Working-Set Mutation

Any code path that writes to the working set (append/edit/delete a
transaction, delete-all, import, sync) must keep two things up to date:

1. **Device transaction lists** — the store notifies its subscribers on every
   change. Pages that list device transactions (e.g.
   `src/routes/journal/+page.svelte`) call
   `$effect(() => subscribeXactStore(load))` and re-fetch, so they need no
   manual refresh. This also covers changes that arrive from another device.
2. **Full ledger + change indicator (`reloadLedgerFromOpfs`,
   `src/lib/services/ledgerReload.ts`)** — call `void reloadLedgerFromOpfs()`
   (fire-and-forget, in the background) after the write. It invalidates
   `fullLedgerService` (used for reports/queries/asset-allocation) so the
   working set is folded in again, and rebases the OPFS staleness snapshot so
   the homepage "modified" indicator doesn't stay stuck out of date. Peer sync
   does this itself after a merge (unless auto-reload is off), and the WebDAV
   page offers a **Reload Ledger** button after a download.

See `src/routes/tx/+page.svelte` (`saveXact`) and
`src/routes/xact-actions/+page.svelte` (`onDeleteConfirmed`,
`onDuplicateClick`) for the reference pattern, and
`src/routes/journal/+page.svelte` (`onDeleteAllConfirmed`) for the same
pattern applied to `clear()`.

## Toolbar Overflow Menu

`Toolbar.svelte` (`src/lib/components/Toolbar.svelte`) takes an optional
`menuItems` snippet prop. When provided, the toolbar renders a kebab
(`⋮`) button that opens a dropdown containing the snippet's content —
use this for page-specific actions that don't warrant a permanent icon in
the toolbar's `actions` slot (e.g. "reset cache", "choose strategy").

Define the snippet at the top level of the page markup (not nested inside
`<main>`) and pass it to `Toolbar` by shorthand:

```svelte
{#snippet menuItems()}
	<ToolbarMenuItem text="Re-read Files" Icon={EraserIcon} onclick={rebuildManifestAndRescan} />
{/snippet}

<main>
	<Toolbar title="My Page" {menuItems}>
		{#snippet actions()}
			<HelpButton topic="my-page" />
		{/snippet}
	</Toolbar>
	...
</main>
```

`ToolbarMenuItem` (`src/lib/components/ToolbarMenuItem.svelte`) renders one
menu row and supports `text`, `Icon`, `disabled`, `onclick`, and
`targetNav` (navigates via `goto` before calling `onclick`). See
`src/routes/sync/beancount/+page.svelte` and
`src/routes/opfs/import-ledger/+page.svelte` for examples.
