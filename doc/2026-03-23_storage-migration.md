# Storage Migration

## Rationale

By adding Rust Ledger in WASM to Cashier, full Beancount functionality has been achieved on all (but particularly mobile) devices.
Taking that into consideration, the need for a JSON storage in IndexedDB makes less sense, in comparison.
With a fast Rust parser, it should be easy and convenient to

- store all transactions in a .beancount file in OPFS
- parse the transactions quickly and provide any information on the ledger
- extract individual transactions for editing
- formatting the full content for storage in OPFS
- export of the device ledger (.bean file)

## Plan

### 1. WASM Initialization and Lifetime

- Initialize `@rustledger/wasm` once at app startup in `+layout.svelte` `onMount`.
- The module binary is already cached as a singleton in `rustledger.ts` via `initWasm()` — no changes needed there.
- Calling `ensureInitialized()` early removes first-use latency on any subsequent page.

### 2. ParsedLedger Lifecycle

- Do **not** keep long-lived `ParsedLedger` instances — they are WASM heap objects requiring explicit `.free()`.
- Pattern for every operation: create → extract needed data → `free()`.
- Store only plain TS objects in Svelte stores, never WASM-owned references.

### 3. Central Ledger Store

Create `src/lib/stores/ledgerStore.ts` as a module-level singleton (same pattern as `AppService`):

- Reads all Beancount source files from OPFS (book.bean, config.bean, accounts.bean, commodities.bean).
- Parses with WASM and populates reactive Svelte `writable` stores:
  - `accountsStore` — accounts with balances (via BQL `SELECT account, sum(position) GROUP BY account`)
  - `transactionsStore` — journal entries (via `getDirectives()`)
  - `validationStore` — parse and validation errors
  - `isLoadingStore` — loading indicator
- Exposes `loadLedger()` (initial load) and `invalidate()` (reload after writes).
- `formatSource(src)` — thin stateless wrapper around WASM `format()`.

### 4. App Startup

In `+layout.svelte` `onMount`:

1. Call `ensureInitialized()` to pre-warm the WASM binary.
2. Call `ledgerStore.loadLedger()` to populate all stores before any page renders.

### 5. Write and Invalidation Flow

- On transaction append or edit: write formatted Beancount text to OPFS, then call `ledgerStore.invalidate()`.
- A single central re-parse fans out reactive updates to all subscribed pages — no per-page re-parsing.

### 6. Validation and Formatting on Save

- Before writing to OPFS: create `ParsedLedger(entry)` → check `isValid()` / `getErrors()` → `free()`.
- If valid: call WASM `format()` to normalize whitespace/alignment, then write to OPFS.
- Block the save and surface errors to the user if validation fails.

### 7. Storage Migration Strategy

End state: OPFS `.bean` file is the single source of truth — both reads and writes go there.

Steps:

1. **One-time import** — on first run with the new code, serialize all existing IndexedDB transactions to Beancount format and write them to `cashier.bean` in OPFS.
2. **Switch reads and writes together** — once the import is complete, all new transactions are appended directly to OPFS. The `ledgerStore` reads exclusively from OPFS. IndexedDB is no longer touched.
3. **Remove IndexedDB** — after the migration is confirmed stable, delete the Dexie schema and related service code.

There is no dual-write period: the migration is atomic from the user's perspective (happens once on startup), after which OPFS is the only store.

### 8. Verification

1. WASM initialized once per session — no repeated binary loads across page navigation.
2. Accounts, balances, and transactions match expected ledger output after parse.
3. Invalid entries are rejected with error messages; valid entries are formatted and persisted.
4. Reactive stores update all subscribed pages after an append or edit without a full refresh.
5. Parse latency stays acceptable on mobile-sized ledgers (validate on a real device).

## Tasks

- [ ] initialize Wasm on startup
- [ ] Store ledger in a .bean file in OPFS
- [ ] append new transactions to the .bean file
- [ ] display transaction list, accounts, and balances by parsing the file
