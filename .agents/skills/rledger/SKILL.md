---
name: rledger
description: Practical guide to using the Rust Ledger WASM in Cashier — which service to use, load sequence, reactive stores, and BQL queries.
---

# rledger — Rust Ledger WASM Usage

## Two services, two purposes

| Service             | File                                     | Use for                                                        |
| ------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| `fullLedgerService` | `src/lib/services/ledgerWorkerClient.ts` | Full multi-file book: reports, BQL queries, accounts, balances |
| `ledgerService`     | `src/lib/services/ledgerService.ts`      | Single transaction file only: LSP, editing, saving xacts       |

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
$: if ($fullLedgerService.version) {
	/* run query */
}
```

| Store           | Type                | Meaning                                                                  |
| --------------- | ------------------- | ------------------------------------------------------------------------ |
| `.loaded`       | `Readable<boolean>` | True once at least one successful load                                   |
| `.version`      | `Readable<number>`  | Increments on every load/invalidate — use to trigger reactive re-queries |
| `.isConfigured` | `Readable<boolean>` | False until .bean files are present                                      |
| `.isReloading`  | `Readable<boolean>` | True during background invalidate                                        |

## BQL query pattern

```ts
const { columns, rows, errors } = await fullLedgerService.query(bql);
// rows is unknown[][] — index by column position
const accountIdx = columns.indexOf('account');
const name = (rows[0] as any[])[accountIdx];
```

Returns `{ columns: [], rows: [], errors: [] }` (empty, no throw) if not loaded.

### BQL Reference

- [BQL](https://rustledger.github.io/reference/bql.html)

### Dates

The dates in BQL queries are written without quotes. I.e.

```sql
... WHERE date > 2026-01-01
```

## Other fullLedgerService methods

```ts
await fullLedgerService.getAllAccounts(); // open accounts + currencies
await fullLedgerService.getOperatingCurrencies(); // from ledger options
await fullLedgerService.getAccountWithBalances(accountName); // returns Account | null
await fullLedgerService.getDirectives(); // all parsed directives
await fullLedgerService.getErrors(); // parse/validation errors
```

## File loading architecture

- Entry point is `cashier.bean` **only** when no user book is configured.
- When the user's book filename is set (settings key `USER_BOOK_FILENAME`), _that file_ becomes the WASM parse entry point instead — mirroring how it's opened directly on desktop (e.g. `rledger check`) — and `cashier.bean` is folded in via an `include` directive appended to an in-memory copy of the book, **never written to disk**.
- This direction matters: Beancount/rledger only honors `option` directives (e.g. `title`, `inferred_tolerance_default`) declared in the top-level/entry-point file — the same option in an included file is silently ignored (`E7009`). Making the user's book the entry point keeps their own options authoritative instead of requiring them to be duplicated into `cashier.bean`.
- All `.bean` files are read from OPFS; a binary cache is stored at `LEDGER_CACHE_FILE` in OPFS for fast re-loads.

## Low-level WASM (rustledger.ts)

Use `src/lib/services/rustledger.ts` only for single-file or utility operations:

```ts
import rustledger from '$lib/services/rustledger';

await rustledger.ensureInitialized(); // always call first
rustledger.parseSource(source); // ParseResult
rustledger.validateSource(source); // ValidationResult
rustledger.format(source); // { formatted?, errors[] }
rustledger.createLedger(files, entryPoint); // Ledger (multi-file, manual)
```

For multi-file queries in the app, prefer `fullLedgerService.query()` — it manages lifecycle and runs off the main thread.
