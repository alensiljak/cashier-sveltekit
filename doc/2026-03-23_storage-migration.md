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

### 1. WASM Initialization

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

### 3. LedgerService

Create `src/lib/services/ledgerService.ts` as a module-level singleton:

```ts
class LedgerService {
	private ledger: ParsedLedger | null = null;
	private _version = writable(0); // reactive change signal
	readonly version = derived(this._version, (v) => v);

	/** Read OPFS → combine → create ParsedLedger. */
	async load(): Promise<void>;

	/** Free old ledger, re-read cashier.bean, recombine, create new ParsedLedger, bump version. */
	async invalidate(): Promise<void>;

	/** Run a BQL query, return { columns, rows }. */
	query(bql: string): QueryResult;

	/** Return parsed directives (transactions, balances, opens, …). */
	getDirectives(): Directive[];

	/** Parse + validation errors from the current ledger. */
	getErrors(): { parse: Error[]; validation: Error[] };

	/** Stateless: format a Beancount source string. */
	format(source: string): string;

	/** Append a formatted transaction to cashier.bean → invalidate. */
	async appendTransaction(beancountText: string): Promise<void>;
}

export default new LedgerService();
```

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

### 5. App Startup

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
2. Validate with the stateless `validate(source)` function. These are direct WASM calls — no `ParsedLedger` instance needed for one-off formatting or validation of individual entries. Block save on errors.
3. Write formatted text to `cashier.bean` (append for new, rewrite for edit/delete).
4. Call `ledgerService.invalidate()` — frees old ParsedLedger, re-reads OPFS, creates new one, bumps `version`.
5. Every subscribed page re-queries automatically via the reactive `version` dependency.

### 7. Locating and Editing Individual Transactions

To extract and edit individual transactions, parse `cashier.bean` independently — since all device-writable transactions live in that file, there is no need to resolve line numbers through the combined ledger.

#### Transaction identity

Transactions are identified by their **line range in `cashier.bean`** (`startLine`, `endLine`). When the journal page lists transactions, each row carries these coordinates. Tapping a row passes the line range to the editor.

#### Static parsing methods

Add static utility methods to `LedgerService` for one-off parsing of `cashier.bean`:

```ts
class LedgerService {
	/** Parse cashier.bean source and return all transaction directives with their line ranges. */
	static async getTransactionsWithRanges(
		source: string
	): Promise<Array<{ directive: Directive; range: { startLine: number; endLine: number } }>>;

	/** Extract a single transaction from cashier.bean by line range. */
	static extractTransaction(source: string, startLine: number, endLine: number): Directive;

	/** Replace lines [startLine, endLine] in cashier.bean with `newText`, then re-read and return updated source. */
	static async replaceLines(startLine: number, endLine: number, newText: string): Promise<string>;

	/** Delete lines [startLine, endLine] in cashier.bean, then re-read and return updated source. */
	static async deleteLines(startLine: number, endLine: number): Promise<string>;
}
```

These methods:

- Work entirely on `cashier.bean` content (passed as a string argument).
- Use the same WASM parser to extract line ranges — no complex mapping logic.
- Return both structured `Directive` objects (for form binding) and raw line content (for editing).
- Are stateless: they take source as input and return the result without touching `LedgerService` state.

#### Edit flow

1. **List** — Call `LedgerService.getTransactionsWithRanges(source)` to populate the journal. Each row stores `startLine` and `endLine`.
2. **Open** — The editor receives `(startLine, endLine)` from the row tap. Call `LedgerService.extractTransaction(source, startLine, endLine)` to get the parsed `Directive` for form binding.
3. **Modify** — The user edits fields. On save the editor produces replacement Beancount text via `format()`.
4. **Validate** — Run the stateless `validate()` WASM call on the replacement text. Block save on errors.
5. **Splice** — Call `LedgerService.replaceLines(startLine, endLine, newText)` to update `cashier.bean` in OPFS.
6. **Invalidate** — Call `ledgerService.invalidate()` to rebuild the full `ParsedLedger`. All subscribed pages re-query automatically via `version`.

Delete follows the same flow but calls `LedgerService.deleteLines()` instead.

#### Edge cases

- **Concurrent edits** — The app is single-user and single-tab (PWA). No locking needed; writes to `cashier.bean` are atomic from the OPFS perspective.
- **Multiline metadata / comments** — The WASM parser's `getDocumentSymbols()` covers the full extent of a directive including tags, links, and metadata lines. Comments on their own line above a transaction are not part of its range, which is acceptable since the migration writer does not emit detached comments.
- **Newly appended transactions** — A new transaction is appended to `cashier.bean` (no splice needed). Its line range is available after calling `LedgerService.getTransactionsWithRanges()` on the updated source.

### 8. Storage Migration Strategy

End state: `cashier.bean` in OPFS is the single source of truth for device transactions.

Steps:

1. **One-time import** — on first run with the new code, serialize all existing IndexedDB transactions to Beancount format (via `appService.getExportTransactions()` or equivalent) and write them to `cashier.bean` in OPFS. Mark migration complete in a `Setting`.
2. **Switch reads and writes together** — once the import is complete, all new transactions are appended directly to OPFS. `LedgerService` reads exclusively from OPFS. IndexedDB is no longer touched for transaction/account data.
3. **Remove IndexedDB transaction tables** — after the migration is confirmed stable, delete the Dexie `xacts`, `accounts`, `payees`, `lastXact` tables and related DAL/service code. Keep `settings` and `scheduled` tables (they are not part of the ledger).

There is no dual-write period: the migration is atomic from the user's perspective (happens once on startup), after which OPFS is the only store.

### 9. AppService Audit

After migration, most `AppService` read methods become dead code (replaced by BQL queries). Write methods need refactoring:

- **Remove**: `loadAccount()`, `loadFavouriteAccounts()`, `loadTransaction()`, `getExportTransactions()`, `importBalanceSheet()`, `importPayees()` — all replaced by BQL or direct OPFS writes.
- **Refactor**: `saveTransaction()`, `deleteTransaction()`, `duplicateTransaction()` — rewrite to modify `cashier.bean` in OPFS and call `ledgerService.invalidate()`.
- **Keep**: `getDefaultCurrency()`, `getInvestmentCommodities()`, settings-related methods, `translateToBeancount()` (useful for migration), formatting helpers.

### 10. Sync Interaction

When infrastructure files are updated via Cashier Server sync:

1. Updated `.bean` files are written to OPFS.
2. Call `ledgerService.invalidate()` to rebuild the combined source with fresh infrastructure.
3. Pages reactively pick up new accounts, commodities, etc.

### 11. Verification

1. WASM initialized once per session — no repeated binary loads across page navigation.
2. Accounts, balances, and transactions match expected ledger output after parse.
3. Invalid entries are rejected with error messages; valid entries are formatted and persisted.
4. Pages reactively update after writes or sync via `version` subscription — no manual refresh.
5. Parse + query latency stays acceptable on mobile-sized ledgers (validate on a real device).
6. Only `cashier.bean` is written on-device; infrastructure files are read-only.

## Tasks

- [ ] Create `LedgerService` singleton with live ParsedLedger, `query()`, `invalidate()`, `version` store
- [ ] Initialize WASM + `ledgerService.load()` in `+layout.svelte` `onMount`, gate `<slot />` on ready
- [ ] One-time migration: serialize IndexedDB transactions → `cashier.bean` in OPFS
- [ ] Rewrite transaction save/edit/delete to target `cashier.bean` + `invalidate()`
- [ ] Migrate journal page to BQL queries via `LedgerService`
- [ ] Migrate accounts page to BQL queries via `LedgerService`
- [ ] Migrate remaining pages (payees, favourites, tx editor, etc.) to `LedgerService`
- [ ] Wire sync flow: after infrastructure files update → `invalidate()`
- [ ] Audit and remove dead `AppService` read methods + IndexedDB transaction tables
- [ ] Verify on mobile device: parse + query latency, memory, PWA offline
