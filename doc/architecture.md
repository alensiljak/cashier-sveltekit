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
- `ledgerWorkerClient` (imported as `fullLedgerService`) loads the complete book in a background Worker and is used to run financial reports and queries. It reads all `.bean` files from OPFS; if the user has configured their own book file, that file (not `cashier.bean`) is used as the WASM parse entry point, with `cashier.bean`'s device transactions folded in via an `include` line injected in memory. This keeps `option` directives declared in the user's book authoritative — Beancount/rledger only honors options set in the top-level (entry point) file, ignoring the same option when it appears in an included file. With no user book configured, `cashier.bean` is the entry point on its own.
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
