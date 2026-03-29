# Engine Migration

## Rationale

By adding Rust Ledger in WASM to Cashier, full Beancount functionality has been achieved on all (but particularly mobile) devices. The rledger demo page has proven all required concepts — parsing, editing, saving, and using .beancount files directly. Performance is excellent.

Transitioning to the Rust Ledger WASM engine is a viable alternative to IndexedDB with JavaScript parsing. The transition allows using .beancount files directly without unnecessary format conversions, and provides full reports via the BQL query engine.

With a fast Rust parser, it should be easy and convenient to

- store all transactions in a .beancount file in OPFS
- parse the transactions quickly and provide any information on the ledger
- extract individual transactions for editing
- formatting the full content for storage in OPFS
- export of the device ledger (.bean file)

## Proven Concepts (rledger demo)

The following have been validated on the rledger page and can be relied upon during migration:

- WASM initialization and `ParsedLedger` creation (`rustledger.ts`)
- BQL queries for accounts and balances (`getAccountsFromTransactions`)
- `getDocumentSymbols()` for mapping directives to line ranges (`sourceEditor.ts`)
- Surgical text replacement via `replaceDirectiveBySpan()` (`sourceEditor.ts`)
- `DirectiveFormatter.toString()` for generating beancount text
- OPFS read/write for infrastructure files (`opfslib.ts`)
- Parse + validation error reporting

## File Layout

| File               | Source       | Description                                         |
| ------------------ | ------------ | --------------------------------------------------- |
| `cashier.bean`     | device       | Device transactions — the only file written locally |
| `book.bean`        | desktop sync | Top-level `include` directives and options          |
| `config.bean`      | desktop sync | Beancount option/plugin directives                  |
| `accounts.bean`    | desktop sync | `open` / `close` directives                         |
| `commodities.bean` | desktop sync | Commodity definitions                               |

On every parse, infrastructure files (synced from desktop) are concatenated with `cashier.bean` to form the **full ledger source**. Only `cashier.bean` is ever written to on the device.

## Plan

### 1. WASM Initialization ✅

- Initialize `@rustledger/wasm` once at app startup in `+layout.svelte` `onMount`.
- The module binary is already cached as a singleton in `rustledger.ts` via `initWasm()` — no changes needed there.
- Calling `ensureInitialized()` early removes first-use latency on any subsequent page.

### 2. Live ParsedLedger — the Query Engine

Since parsing is extremely fast and the device ledger is small, keep **one long-lived `ParsedLedger`** instance that serves as the query engine for the entire app:

- Created once on startup after reading all OPFS files.
- Destroyed and recreated only when the source changes (write, sync).
- Pages run **BQL queries** against it to get whatever data view they need — accounts, balances, filtered transactions, payees, etc.
- The `ParsedLedger` lives inside `LedgerService`; no page ever holds a direct WASM reference.

Lifecycle: `create → query … query … query → free → create (on invalidate) → …`

This replaces the idea of pre-populating typed Svelte stores. BQL is the data-access layer.

### 3. LedgerService ✅

`src/lib/services/ledgerService.ts` exists as a module-level singleton with the core API:

```ts
class LedgerService {
	private ledger: ParsedLedger | null = null;
	private _version = writable(0); // reactive change signal
	readonly version: Readable<number>;

	async load(): Promise<void>;          // Read OPFS → combine → create ParsedLedger
	async invalidate(): Promise<void>;    // Free old, reload, bump version
	query(bql: string): QueryResult;      // Synchronous BQL query
	getDirectives(): Directive[];         // Parsed directives
	getParseErrors(): BeancountError[];   // Parse errors
	getValidationErrors(): BeancountError[]; // Validation errors
	isValid(): boolean;                   // Combined validity check
	format(source: string): FormatResult; // Stateless formatting
	parseSource(source: string): void;    // Parse and set as current ledger
	async appendTransaction(beancountText: string): Promise<void>; // TODO
	free(): void;                         // Cleanup
}
```

**Remaining work:**

- `readAndCombineSources()` is a TODO returning `''` — needs to read OPFS infrastructure files + `cashier.bean` and concatenate (logic already proven in the rledger page `loadInfrastructure()`).
- `appendTransaction()` is a TODO — needs to read `cashier.bean` from OPFS, append text, write back, then `invalidate()`.

Key points:

- `version` is a Svelte readable store. Pages subscribe to it for reactivity.
- `query()` is synchronous — the ParsedLedger is already in memory.
- All WASM details are encapsulated; consumers see only plain JS objects.

### 4. Reactive Data Access in Pages

Pages no longer use `+page.ts` `load()` for ledger data. Instead they query `LedgerService` reactively:

```svelte
<script>
  import ledgerService from '$lib/services/ledgerService';

  // Re-runs whenever the ledger is invalidated (version bumps).
  const accounts = $derived.by(() => {
    ledgerService.version;  // reactive dependency
    return ledgerService.query(
      'SELECT account, sum(position) AS balance GROUP BY account ORDER BY account'
    );
  });
</script>
```

For filtered / derived views (e.g. transactions for one account, distinct payees), pages simply run a different BQL query — no new store or extraction logic needed.

`+page.ts` load functions that currently read IndexedDB are deleted for any data that comes from the ledger. Non-ledger data (settings, scheduled transactions, asset allocation) can stay in IndexedDB/stores as-is.

### 5. App Startup ✅

In `+layout.svelte` `onMount`:

1. `await ensureInitialized()` — pre-warm the WASM binary.
2. `await ledgerService.load()` — read OPFS, build combined source, create ParsedLedger.

Gate the `<slot />` behind a loading check so child pages don't render before the ledger is ready:

```svelte
{#if $ledgerReady}
  <slot />
{:else}
  <LoadingSpinner />
{/if}
```

### 6. Write and Invalidation Flow

All writes target `cashier.bean` in OPFS only:

1. Format the new/edited transaction with the stateless `format(source)` function.
2. Validate by calling `validateSource()` directly on the transaction string. This is a lightweight WASM call that returns parse/validation errors without allocating a full `ParsedLedger`. Block save on errors.
3. Write formatted text to `cashier.bean` (append for new, rewrite for edit/delete).
4. Call `ledgerService.invalidate()` — frees old ParsedLedger, re-reads OPFS, creates new one, bumps `version`.
5. Every subscribed page re-queries automatically via the reactive `version` dependency.

### 7. Locating and Editing Individual Transactions

To extract and edit individual transactions, parse `cashier.bean` independently — since all device-writable transactions live in that file, there is no need to resolve line numbers through the combined ledger.

#### Transaction identity

Transactions are identified by their **line range in `cashier.bean`** (`startLine`, `endLine`). When the journal page lists transactions, each row carries these coordinates. Tapping a row passes the line range to the editor.

#### Source editing via `sourceEditor.ts` ✅

The editing layer is already implemented in `src/lib/rledger/sourceEditor.ts` and proven on the rledger page. It provides:

- **`mapDirectiveSpans(source, ledger): DirectiveSpan[]`** — maps each directive to its exact line range using `getDocumentSymbols()`.
- **`replaceDirectiveBySpan(source, spans, spanIndex, newText): string`** — surgical text replacement of a single directive while preserving all other content.
- **`findSpanForDirective(spans, directiveIndex, source, directives): number`** — resolves a directive index to its span index (handles cases where symbols and directives don't align 1:1).

`LedgerService` delegates to `sourceEditor.ts` for all text-level editing. No duplicate static methods needed on `LedgerService` itself.

#### `TransactionDirective` → `Xact` field mapping

`TransactionDirective` (from WASM) carries all parsed fields needed to populate `Xact` directly — no text re-parsing required. `mapDirectiveSpans()` is called in parallel to get the line ranges; the two arrays are zipped by index.

| `TransactionDirective` field | `Xact` / `Posting` field | Notes                                                |
|------------------------------|--------------------------|------------------------------------------------------|
| `date`                       | `Xact.date`              | ISO date string — identical format                   |
| `payee`                      | `Xact.payee`             | Optional in both                                     |
| `narration`                  | `Xact.note`              | Different name                                       |
| `flag`                       | —                        | Not represented in `Xact`; default `*` on write      |
| `tags`                       | —                        | Not represented in `Xact`; preserved via span splice |
| `links`                      | —                        | Not represented in `Xact`; preserved via span splice |
| `postings[n].account`        | `Posting.account`        | Direct                                               |
| `postings[n].units.number`   | `Posting.amount`         | `string` → `number` conversion needed                |
| `postings[n].units.currency` | `Posting.currency`       | Direct                                               |
| `postings[n].cost`           | —                        | Not represented in `Xact`                            |
| `postings[n].price`          | —                        | Not represented in `Xact`                            |

Fields with no `Xact` equivalent (`flag`, `tags`, `links`, `cost`, `price`) are preserved automatically by the span-splice approach — the original source lines are kept intact for anything the UI doesn't touch.

#### Edit flow

1. **List** — Call `getDirectives()` and `mapDirectiveSpans(source, ledger)` together. Map each `TransactionDirective` onto an `Xact` using the table above. Zip directives and spans by index so each row carries both its `Xact` and its `DirectiveSpan`.
2. **Open** — The editor receives the `Xact` (pre-populated from the directive) and its `DirectiveSpan`. No text re-parsing needed.
3. **Modify** — The user edits fields. On save the editor produces replacement Beancount text via `DirectiveFormatter.toString()`.
4. **Validate** — Call `validateSource()` directly on the replacement text. Block save on errors.
5. **Splice** — Call `replaceDirectiveBySpan(source, spans, spanIndex, newText)` to produce updated source, then write to `cashier.bean` in OPFS.
6. **Invalidate** — Call `ledgerService.invalidate()` to rebuild the full `ParsedLedger`. All subscribed pages re-query automatically via `version`.

Delete follows the same flow — replace the span with an empty string (or omit the span lines entirely).

#### Edge cases

- **Concurrent edits** — The app is single-user and single-tab (PWA). No locking needed; writes to `cashier.bean` are atomic from the OPFS perspective.
- **Multiline metadata / comments** — The WASM parser's `getDocumentSymbols()` covers the full extent of a directive including tags, links, and metadata lines. Comments on their own line above a transaction are not part of its range, which is acceptable since the migration writer does not emit detached comments.
- **Newly appended transactions** — A new transaction is appended to `cashier.bean` (no splice needed). Its line range is available after calling `mapDirectiveSpans()` on the updated source.

### 8. Storage Migration Strategy

End state: `cashier.bean` in OPFS is the single source of truth for device transactions. IndexedDB is not used for journal data.

Steps:

1. **Switch reads and writes** — all new transactions are appended directly to `cashier.bean` in OPFS. `LedgerService` reads exclusively from OPFS. IndexedDB is no longer touched for transaction/account data.
2. **Remove IndexedDB transaction tables** — delete the Dexie `xacts`, `accounts`, `payees` tables and related DAL/service code. Keep `settings` and `scheduled` tables (they are not part of the ledger).

There is no dual-write period. OPFS is the only store from the start.

### 9. AppService Audit

After migration, most `AppService` read methods become dead code (replaced by BQL queries). Write methods need refactoring:

- **Remove**: `loadAccount()`, `loadFavouriteAccounts()`, `loadTransaction()`, `getExportTransactions()`, `importBalanceSheet()`, `importPayees()` — all replaced by BQL or direct OPFS reads.
- **Refactor**: `saveTransaction()`, `deleteTransaction()`, `duplicateTransaction()` — rewrite to modify `cashier.bean` in OPFS (using `sourceEditor.ts` for splicing) and call `ledgerService.invalidate()`.
- **Keep**: `getDefaultCurrency()`, `getInvestmentCommodities()`, settings-related methods, formatting helpers.

### 10. Sync Interaction

When infrastructure files are updated via Cashier Server sync:

1. Updated `.bean` files are written to OPFS.
2. Call `ledgerService.invalidate()` to rebuild the combined source with fresh infrastructure.
3. Pages reactively pick up new accounts, commodities, etc.

### 11. Export

Export is done by providing `cashier.bean` file contents in the Export page - either for clipboard copy, Web Share, or file download.

### 12. Verification

1. WASM initialized once per session — no repeated binary loads across page navigation.
2. Accounts, balances, and transactions match expected ledger output after parse.
3. Invalid entries are rejected with error messages; valid entries are formatted and persisted.
4. Pages reactively update after writes or sync via `version` subscription — no manual refresh.
5. Parse + query latency stays acceptable on mobile-sized ledgers (validate on a real device).
6. Only `cashier.bean` is written on-device; infrastructure files are read-only.

## Tasks

| #  | Task                                                                                                                                     | Depends on | Status |
|----|------------------------------------------------------------------------------------------------------------------------------------------|------------|--------|
| 1  | Implement `readAndCombineSources()` in LedgerService — read OPFS infra files + cashier.bean, concatenate                                 | —          | ✅      |
| 2  | Gate app startup on ledger ready — `+layout.svelte`: init WASM, `ledgerService.load()`, gate `<slot/>`                                   | 1          | ✅      |
| 3  | Rewrite save/edit/delete targeting `cashier.bean` — use `sourceEditor.ts` for splicing, `appendTransaction` for new, call `invalidate()` | 1          | ✅      |
| 4  | Migrate journal page to BQL queries via `LedgerService`                                                                                  | 2          | ✅      |
| 5  | Migrate accounts page to BQL queries via `LedgerService`                                                                                 | 2          | ✅      |
| 6  | Migrate remaining pages (payees, favourites, tx editor, etc.) to `LedgerService`                                                         | 4, 5       | todo   |
| 7  | Wire sync flow: after infrastructure files update → `invalidate()`                                                                       | 2          | ✅      |
| 8  | Update export to serve `cashier.bean` contents directly from OPFS                                                                        | 2          | todo   |
| 9  | Audit and remove dead `AppService` read methods + IndexedDB transaction tables                                                           | 4–8        | todo   |
| 10 | Verify on mobile device: parse + query latency, memory, PWA offline                                                                      | 9          | todo   |
| 11 | Handle `lastXact` table and memorized transactions                                                                                       |            | todo   |

### Completed

- [x] WASM initialization — singleton in `rustledger.ts`, `ensureInitialized()` available
- [x] `LedgerService` singleton with `query()`, `invalidate()`, `version` store
- [x] Source editing layer — `sourceEditor.ts` with `mapDirectiveSpans`, `replaceDirectiveBySpan`, `findSpanForDirective`
- [x] Directive formatting — `directiveFormatter.ts` with `DirectiveFormatter.toString()`
- [x] OPFS file utilities — `opfslib.ts` with `readFile`, `saveFile`, `listFiles`, `deleteFile`
- [x] RLedger demo page proving all concepts end-to-end
- [x] LedgerService write methods — `appendTransaction`, `editTransaction(span)`, `deleteTransaction(span)` using `sourceEditor.ts` for span-based splicing
- [x] `xactSpan` store in `mainStore.ts` — carries `DirectiveSpan` for the transaction being edited; `undefined` for new transactions
- [x] `xactToBeancountText(xact)` helper in `xactUtils.ts` — converts `Xact` to Beancount text via `DirectiveFormatter`
- [x] `tx/+page.svelte` save flow — uses `ledgerService.editTransaction(span)` or `appendTransaction` based on `xactSpan`
- [x] `xact-actions/+page.svelte` delete and duplicate — use `ledgerService.deleteTransaction(span)` and `appendTransaction`

### Design Decisions

- **Xact stays as view/edit model.** `TransactionDirective` from WASM is richer (flag, tags, links, posting cost/price) but replacing Xact would touch 40+ files. Xact remains the UI model; conversion from `TransactionDirective` happens at the LedgerService boundary using the field mapping table in §7. Fields not represented in `Xact` (flag, tags, links, cost, price) are preserved automatically by the span-splice approach. Revisit after migration is complete and new features are planned.
- **Transaction identity via `DirectiveSpan`.** Transactions in `cashier.bean` are identified by their line range (`startLine`/`endLine`), not a numeric ID. The `xactSpan` store (to be added to `mainStore.ts`) will carry this alongside the `xact` store when editing existing transactions.
