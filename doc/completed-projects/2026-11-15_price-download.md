# Price Download

Download foreign-exchange reference prices into the book, manually, starting with the ECB daily reference rates. Downloaded prices are written to a user-chosen destination file (default `prices/prices.current.bean`) in OPFS — wiring it into the book via `include` is the user's own setup, not something the app manages.

## Decisions

1. **Source for v1: the Frankfurter API, pinned to the ECB provider** (see below).
2. **Provider is selectable by the user.** Not everyone uses ECB rates or currencies; the provider dropdown lists the registered providers and v1 ships one entry.
3. **Manual trigger only** — a button. No fetch on app open, no background sync.
4. **User-chosen destination file**, default `prices/prices.current.bean`. The app does not inspect or edit the user's book to add an `include` — the user sets up their Beancount files themselves.
5. **Write mode switch: overwrite or append**, default overwrite (matches the `current` file naming).
6. **Pairs are stored in the provider's published direction** — no inversion or cross-rate math in the app. The ledger engine inverts and chains automatically (verified in rustledger's price module, see below). The app's default currency is always included in the fetched symbol set so conversions into it always exist.
7. **Book-relevant symbols only** — derived from what the book actually uses; not the provider's full symbol list.

## Why not the ECB XML directly

The raw ECB feed (`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`) sends no `Access-Control-Allow-Origin` header, so a browser cannot fetch it — a client-side PWA gets a CORS error. Any direct-from-ECB approach therefore needs a server-side proxy. The app is deployed as pure static assets on Cloudflare Workers; a proxy would be a new always-on component on the critical path of a core feature.

Frankfurter (`api.frankfurter.dev`, open source, no API key, no rate limiting for our one-call-per-day usage) serves the same ECB reference rates with CORS enabled.

Two Frankfurter specifics matter:

- **Pin the provider.** Frankfurter v2 aggregates 200+ currencies from 100+ sources, including crypto. We must not accidentally fetch those. The provider-pinned endpoint serves the ECB fixing specifically:

  ```
  GET https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=USD,CHF
  → [{"date":"2026-11-13","base":"EUR","quote":"CHF","rate":0.9266},
     {"date":"2026-11-13","base":"EUR","quote":"USD","rate":1.1052}]
  ```

  (Note `quotes`, not `symbols`; `symbols` returns HTTP 422.)

- **Read the date from the response, never today's.** After ~16:00 CET the latest fixing is today's; before that, and on weekends/holidays, it is the previous business day. The response `date` is authoritative.

Mitigation for the third-party dependency: the provider sits behind a small interface selected by the user. Swapping in a self-hosted Cloudflare Worker proxy over the raw ECB XML later — removing Frankfurter entirely — is a new registry entry that implements the same interface.

The ECB requests the feed's use be attributed; include a comment line in the file (see format below).

## What gets written

Beancount price directives, one per pair and fixing date, **exactly as the provider publishes them** — for ECB that is EUR-base:

```beancount
; ECB reference rates (via frankfurter.dev, provider ecb)
2026-11-13 price EUR 0.9266 CHF
2026-11-13 price EUR 1.1052 USD
```

**The engine inverts and chains for us.** rustledger's price module (`crates/rustledger-query/src/price.rs`) builds a bidirectional lookup index over the declared pairs, mirroring CPython Beancount's price database:

- A `price EUR 1.1052 USD` directive alone is enough to `CONVERT('100 USD', 'EUR')` — the inverse leg (`USD → 1/1.1052 EUR`) is derived on lookup, not stored.
- Chained conversion also works: with `price EUR 1.1052 USD` plus a security priced `AAPL → 150 USD`, valuing AAPL in EUR resolves through both legs, per-leg using the newest rate on or before the lookup date.

So the provider stays a dumb pass-through: no inversion math, no cross-rate computation, no rounding beyond emitting the number the source served. The app's default currency (settings key `currency`) is simply one of the fetched symbols, guaranteeing pair coverage into it.

One caveat from the same price module: when a book declares price series in _both_ directions of the same pair, the lookup index coalesces them (the denser series wins per pair, mirroring `bean-query`). A fresh opposite-direction series would therefore be **silently ignored**. So a symbol whose pair the book already maintains is not skipped, but downloaded and written **in the book's own series direction** (`price USD … EUR` style, rate inverted) — extending the user's series with new fixing dates instead of fighting it. The direction of the user's own series (outside the destination file) takes priority over pairs this app wrote earlier into the destination file. Securities — commodity directives carrying `ticker`/`isin` metadata — are classified out of the FX plan entirely, not reported as missing rates.

## File format and write modes

The file format is the same in both modes; only retention differs.

- **Grammar**: `<date> price <BASE> <number> <QUOTE>` lines, sorted by (date, base, quote), plus a header comment written by the service. All lines produced by a single run are rewritten through the fixed formatter, so output is stable.
- **Overwrite (default)**: the file is machine-managed — it is rewritten with exactly the latest fixing's directives (plus the header). Matches the `prices.current.bean` "current snapshot" convention. Anything else in the file (comments, directives the user put there by hand) is lost — the page says so under the toggle.
- **Append**: existing content passes through untouched; new `<date, base, quote>` keys are added; same key with a different rate gets the incoming value (ECB almost never corrects a fixing, and if it does, every device converges to the same corrected value). The file gradually accumulates a price history of everything downloaded.

Sync convergence note: two devices that fetch the same fixing produce _identical file content_, so the S3/WebDAV per-file sync (`data/files/<opfs path>`, hash-compared) sees "equivalent" and transfers nothing. Two devices that fetched _different_ fixings (one stale) produce different content — in append mode that converges on the next run; in overwrite mode it is an ordinary file change the user resolves by keeping one side or re-running the download. This is expected behavior, not a special case to engineer around.

## Settings

Shared settings (all devices should write the same file the same way; shared, not per-device, to avoid divergence):

- `prices.provider` — provider id from the registry (v1: `ecb-frankfurter`).
- `prices.targetFile` — destination path in OPFS, default `prices/prices.current.bean`.
- `prices.writeMode` — `'overwrite' | 'append'`, default `'overwrite'`.

Per-device status setting: last run time, last fixing date, added/updated/final line counts, last error, if any.

Adding to `SettingKeys` in `src/lib/settings.ts` follows the existing flat-key style.

## Book-relevant symbols

The requested symbol set is derived from the loaded ledger — a pure function over its inputs, unit-tested apart from the ledger. Inputs:

- the app's default currency (settings key `currency`),
- operating currencies (`fullLedgerService.getOperatingCurrencies()`),
- both sides of existing price directives (`fetchBookPricePairs` — the BQL `prices` table),
- the currencies of open accounts (`fetchAccountCurrencies`),
- declared securities (`fetchDeclaredSecurities` — `commodity` directives with `ticker`/`isin` metadata, filtered out of the FX plan entirely),

minus the provider's base currency (EUR for ECB — its pairs are fetched natively). Coverage is checked first, so tickers land in the `securities` bucket instead of being reported as missing rates. For covered currencies whose EUR-pair the book already maintains, the plan returns them as **inverted symbols**: fetched natively, written in the book's series direction (see the coalescing caveat above). If the resulting set (native + inverted) is empty (EUR-only book, EUR default), the download button is disabled with an explanation — nothing to fetch. Currencies the provider does not cover (e.g. one the ECB does not publish) are listed as skipped; the rest is written.

## Module layout

```
src/lib/services/prices/
  priceProvider.ts        # PriceProvider interface + registry
  ecbPriceProvider.ts     # ECB via Frankfurter /providers/ecb/rates
  priceFileService.ts     # read/format/write of the target file (pure formatting+merge logic)
  priceCurrencies.ts      # derivation of the book-relevant symbol set
src/routes/prices/download/+page.svelte
```

`PriceProvider`:

```ts
interface FetchedQuotes {
	source: string; // 'ecb'
	asOf: string; // fixing date, ISO — from response, not today
	// Pairs in the provider's published direction, verbatim.
	// The engine inverts them on lookup; the app never re-denominates.
	quotes: Array<{ base: string; rate: number; quote: string }>;
}
interface PriceProvider {
	id: string;
	name: string; // shown in the dropdown
	// `base` is exposed for documentation/UI; ECB is always EUR.
	fetchLatest(symbols: string[]): Promise<FetchedQuotes>;
	covers(symbol: string): Promise<boolean> | boolean; // for the skip-with-warning path
}
```

The name is deliberately generic — securities price providers later implement the same interface and appear in the same dropdown; the file writer and the UI do not care where the numbers came from.

## UI sketch

One new page, `max-w-2xl mx-auto`, `Toolbar` with a `HelpButton`:

- **Configuration card**
  - Provider dropdown (registry entries; v1 shows "ECB reference rates" only).
  - Destination file — a dropdown of existing `.bean` files in OPFS (via the existing OPFS scan utilities) plus a free-text field for a new path; defaults to `prices/prices.current.bean`.
  - Write mode toggle: Overwrite / Append (DaisyUI `.toggle` paired with `bg-transparent bg-none` per the architecture notes), with a one-line explanation of what each does.
- **Status card** — target file, last run, last fixing date, line count in file, last error if any.
- **Pairs preview** — read-only chips of the symbols that would be fetched, derived live from the ledger, with skipped-for-coverage symbols greyed out after a run.
- **Download** button → result summary (written N lines, fixing date, skipped symbols).
- **Demo mode** notice: in demo mode the download still works (writes the destination file), but whether it takes effect depends on the user's own includes — the demo book keeps serving its fixture prices. Never hand-edit the demo book; extend the fixtures instead (see AGENTS.md).

Entry points: a row in Settings, and a "rates may be stale" hint on the currency-converter page linking here.

## Error handling

- Fetch failure / offline: file untouched, error surfaced on the page. Never a partial write.
- Response validation before writing: for the ECB provider, an array of `{date, base, quote, rate}` with `base === 'EUR'`, every `quote` ∈ requested set, `rate` a positive finite number, `date` parseable. Anything else → abort with a parse error, no write.
- `AbortController` timeout (~15 s).
- Empty symbol set → button disabled with explanation (no API call).
- Unsupported symbols → skipped, listed in the result summary, remaining symbols written.

## Testing

- **Unit** (formatting and merge logic as pure functions): directive formatting emits the native pair verbatim; overwrite mode output; append mode adds/dedupes/replaces and preserves foreign lines; deterministic ordering and formatting (same input → same bytes); response validator against fixture JSON including malformed cases; symbol-set derivation (incl. the inverse-direction skip); skip-with-warning path.
- **Engine integration** (exists: `tests/unit/priceConversion.test.ts`): a `CONVERT` query through the low-level `rustledger` helpers resolves a fetched pair in _both_ directions off native-direction directives, chains a commodity leg through an inverted FX leg (`AAPL → USD → EUR`), and exercises the nested `prices/prices.current.bean` include resolution. It also pins a subtlety the feature must respect: when no price path exists, `CONVERT` does **not** return null — it falls back to the unchanged amount in its original currency. Any UI that must know whether a real conversion happened (e.g. showing which pairs a downloaded file can now convert) has to compare the returned currency, not check for null.
- **E2E** on demo data: Playwright route interception returns a canned Frankfurter response; the run is asserted via the status card, and the destination file's exact content is read back from OPFS. Covers overwrite, append to a user-chosen destination (through the OPFS picker), and the unchanged re-run.
- Verify nothing regressed with `npm run verify` — after implementation run the new unit suites plus one e2e against the demo book.

## Out of scope (later, in rough order of value)

1. Backfill / time-series via the same provider (a date-range query — one request for months of fixings, appended by the same service).
2. More providers — securities prices for the brokerage holdings; the dropdown and registry are the seam.
3. Toggle to fetch the provider's full symbol set instead of the book-relevant one.
4. Auto-refresh-on-open with a staleness threshold.
5. Self-hosted CF Worker proxy over the raw ECB XML, replacing the Frankfurter dependency with the same interface.

## Review findings (2026-11-16)

Review of `f72cfa42` (`feat: price downloaders concept`). Four behaviors below were confirmed with throwaway Vitest probes against the real functions (probe file deleted; no code changes). Ordered by risk.

### Status (updated after the fix pass)

Items 1–3, 5–8 and the applicable nits are fixed. Item 4 is mitigated rather than implemented as originally suggested: the destination picker still lists every `.bean` file, but `validateTargetFile` rejects the main book, everything under `DEMO_DIR`, absolute paths, `..` segments and non-`.bean` paths; the page shows the reason and disables the download, so the main book cannot be overwritten from this page. Header attribution is intentionally left as the provider name (`; ECB reference rates (via Frankfurter) — latest fixing: …`): the name already carries the source and the URL is not part of the file contract.

Beyond the list: the destination is chosen with the shared OPFS file picker (new file and new folder supported); a failed run keeps the previous successful status; "nothing to fetch" is recorded; the page warns when the main book does not include the destination (nested includes are followed, glob patterns are not); the status card shows lines in file, skipped symbols and missing symbols — securities are classified out of the FX plan and no longer displayed; the currency converter links here and says when no rate path exists. Item 6 is implemented as: append mode drops the destination's opposite-direction lines for pairs written this run, reported as "N opposite-direction removed". BGN was removed from the ECB list (euro member since 2026-01-01).

Tests: `tests/unit/priceDownloadService.orchestration.test.ts` covers shared config, device status, the fetch → write flow, unchanged re-runs, failure retention, missing symbols, direction handling and destination validation. `tests/e2e/price-download.spec.ts` covers the preview, overwrite and append writes to OPFS, the status card, a user-chosen destination via the picker, and the unchanged re-run.

### Confirmed bugs (original findings)

1. **Append mode rewrites the user's own price lines — data corruption.** `mergePriceFile` (`src/lib/services/prices/priceFileService.ts:143-171`) re-renders every parsed directive through `renderDirectives`, not just incoming keys. `parsePriceLine` strips quotes (`:53-56`), `formatRate` caps at 6 decimals (`:42-48`), and the renderer never re-quotes (`:97-110`). Confirmed:
   - `2026-01-01 price "VTI " 202.50 EUR` → `2026-01-01 price VTI  202.5 EUR` — a different commodity, invalid directive.
   - `202.123456789` → `202.123457`.
   - Trailing `; comment` dropped; every directive moved below the foreign lines.

   This contradicts the append-mode description above ("existing content passes through untouched") and the module comment ("foreign lines pass through verbatim"). Fix: merge in place — keep every existing line verbatim, replace only lines whose `(date, base, quote)` key is in `incoming`, append new keys; render only incoming lines. Update the `canonicalizes recognized user price lines` test.

2. **A zero-rate line crashes append mode.** `parsePriceLine` accepts `0` (`priceFileService.ts:55`); `mergePriceFile` then calls `formatRate(0)` via `renderDirectives` (`:164`), which throws (`:43-45`). Confirmed. Fix: return `null` for `rate <= 0` (treat as foreign), and/or stop rendering untouched lines.

3. **Silent partial success on a missing quote.** `parseEcbResponse` validates every returned quote was requested (`ecbPriceProvider.ts:85`) but never that every requested quote was returned. Confirmed: requested `['USD','CHF']` with a response containing only `USD` yields one quote and no error. The run writes a subset while the plan/status still list the symbol. Fix: return `missing` from `fetchLatest` and surface it (or throw); update the e2e mock to return all requested symbols.

### Data-loss risk

4. **Destination chips offer every `.bean` file, including the main book.** `src/routes/prices/download/+page.svelte:53-57` lists all `.bean` files from `listFileTree()`; one click plus overwrite mode replaces that file. `book.bean` is one click away. Fix: exclude `USER_BOOK_FILENAME` and `DEMO_DIR/*` from the chips, and/or confirm before overwriting an existing file that is not the current destination.

### Correctness gaps

5. **Direction choice ignores series density.** `priceCurrencies.ts:88` uses `.find`, so when both directions exist the first file-order pair wins. The engine coalesces both directions and the denser series wins, so the app can write into the sparser series, which is then ignored. Fix: count occurrences per direction within each priority tier (user pairs before destination pairs) and pick the denser; add a unit test for the both-directions case.

6. **Old opposite-direction lines can outvote a direction change.** Append mode never removes the destination's previous direction for a pair. If the user's series flips direction and the old downloaded series is denser, the new lines lose the engine's coalescing. Fix: when the plan's direction differs from the destination's, drop the opposite-direction directives for that pair in append mode (or force overwrite / warn).

7. **Post-download preview races the reload.** `priceDownloadService.ts:210` fires `void reloadLedgerFromOpfs()`, then the page immediately calls `refreshPlan()` (`+page.svelte:83`). `ensureLoaded()` returns early while `_isReloading`, and `query()` returns empty when not loaded (`ledgerWorkerClient.ts:170,219`), so `fetchBookPricePairs()` can return `[]`; the version bump never re-triggers the page. Fix: subscribe to `fullLedgerService.version` in the page (pattern: `FavouritesCard.svelte:51-56`) and refresh on bump; optionally await the reload in `downloadPrices`.

8. **Idempotent re-runs still write and reload.** `downloadPrices` always `saveFile`s and reloads even when `existing === text`. The deterministic output makes this cheap to detect. Fix: skip the write/reload when unchanged and report "no changes" instead of "N lines added".

### Nits

- `formatRate` can round a tiny positive rate to `0` (`toFixed(6)` → `"0.000000"` → `"0"`), producing an invalid Beancount price. Guard.
- `isIsoDate` (`priceFileService.ts:37`) is exported but unused; `ISO_DATE` exists only for it. Delete.
- `renderDirectives` comparator returns `1` for equal keys (`priceFileService.ts:99-110`); return `0` to keep the sort consistent if duplicates ever reach it.
- `saveConfig` writes three settings sequentially (`priceDownloadService.ts:95-99`); `Promise.all`.
- `refreshPlan` doesn't clear `error` on success (`+page.svelte:61-69`), so a transient plan error sticks.
- Page initial `targetFile` hardcodes the default path; use `PRICES_DEFAULT_DESTINATION`.
- `$effect(() => void load())` is a one-shot load; `onMount` is clearer.
- `fetchLatest` abort check uses `err instanceof DOMException` (`ecbPriceProvider.ts:124`); `err.name === 'AbortError'` is more portable.
- ECB list: verify `BGN` (Bulgaria adopts the euro in 2026) against the current publication set.
- Header attribution lacks the provider id/URL the doc's example shows (`buildPriceFile`, `priceFileService.ts:122`). Not implemented — the provider name already says "via Frankfurter"; see Status.
- No unit tests for `priceDownloadService` orchestration (config, status, direction priority); the pure parts are well covered. Covered by `tests/unit/priceDownloadService.orchestration.test.ts`.
- `priceFileService.test.ts` typo "dentro".

### Suggested order

1. Items 1, 2, 4 — data safety.
2. Item 3 — missing symbols, plus the e2e mock update.
3. Items 5, 6 — direction correctness, with unit tests.
4. Item 7 — reload race and version subscription.
5. Item 8 — skip unchanged writes.
6. Nits.
