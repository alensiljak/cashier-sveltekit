---
name: rledger
description: Practical guide to using the Rust Ledger WASM in Cashier — which service to use, load sequence, reactive stores, and BQL queries.
---

# rledger — Rust Ledger WASM Usage

## Two services, two purposes

| Service | File | Use for |
|---|---|---|
| `fullLedgerService` | `src/lib/services/ledgerWorkerClient.ts` | Full multi-file book: reports, BQL queries, accounts, balances |
| `ledgerService` | `src/lib/services/ledgerService.ts` | Single transaction file only: LSP, editing, saving xacts |

Never use `ledgerService` for financial queries — it does not load the full book.

## fullLedgerService — load sequence

```ts
import fullLedgerService from '$lib/services/ledgerWorkerClient';

await fullLedgerService.ensureLoaded(); // tries OPFS cache first, then full parse
const result = await fullLedgerService.query('SELECT account, sum(position) GROUP BY account');
```

- `ensureLoaded()` — preferred entry point; no-op if already loaded
- `load()` — force full re-parse from files
- `invalidate()` — re-parse and update the OPFS binary cache (call after source files change)
- `reset()` — free in-memory ledger
- `deleteCache()` — free ledger + delete OPFS cache

## Reactive stores

```ts
import fullLedgerService from '$lib/services/ledgerWorkerClient';
import { derived } from 'svelte/store';

// Re-query when the ledger reloads
$: if ($fullLedgerService.version) { /* run query */ }
```

| Store | Type | Meaning |
|---|---|---|
| `.loaded` | `Readable<boolean>` | True once at least one successful load |
| `.version` | `Readable<number>` | Increments on every load/invalidate — use to trigger reactive re-queries |
| `.isConfigured` | `Readable<boolean>` | False until .bean files are present |
| `.isReloading` | `Readable<boolean>` | True during background invalidate |

## BQL query pattern

```ts
const { columns, rows, errors } = await fullLedgerService.query(bql);
// rows is unknown[][] — index by column position
const accountIdx = columns.indexOf('account');
const name = (rows[0] as any[])[accountIdx];
```

Returns `{ columns: [], rows: [], errors: [] }` (empty, no throw) if not loaded.

## Other fullLedgerService methods

```ts
await fullLedgerService.getAllAccounts();          // open accounts + currencies
await fullLedgerService.getOperatingCurrencies();  // from ledger options
await fullLedgerService.getAccountWithBalances(accountName); // returns Account | null
await fullLedgerService.getDirectives();           // all parsed directives
await fullLedgerService.getErrors();               // parse/validation errors
```

## File loading architecture

- Entry point is always `cashier.bean` (the WASM root).
- The user's book filename (from settings key `USER_BOOK_FILENAME`) is injected as an `include` directive into `cashier.bean` **in memory** at load time — never written to disk.
- All `.bean` files are read from OPFS; a binary cache is stored at `LEDGER_CACHE_FILE` in OPFS for fast re-loads.

## Low-level WASM (rustledger.ts)

Use `src/lib/services/rustledger.ts` only for single-file or utility operations:

```ts
import rustledger from '$lib/services/rustledger';

await rustledger.ensureInitialized(); // always call first
rustledger.parseSource(source);       // ParseResult
rustledger.validateSource(source);    // ValidationResult
rustledger.format(source);            // { formatted?, errors[] }
rustledger.createLedger(files, entryPoint); // Ledger (multi-file, manual)
```

For multi-file queries in the app, prefer `fullLedgerService.query()` — it manages lifecycle and runs off the main thread.
