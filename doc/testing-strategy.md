# Testing Strategy

## Context

Cashier is a data-dependent, GUI-heavy PWA (67 routes, ~28k LOC) built on
browser-only APIs — OPFS, IndexedDB (Dexie), File System Access, Web Workers,
WASM (rustledger). There's comparatively little "business logic" in the
traditional sense, but there's a meaningful amount of pure logic (parsers,
formatters, sync/merge rules) where a silent bug means **wrong money or lost
data** — that's the highest-value thing to guard.

The pyramid is shaped for that risk profile: heavier on unit + service layers
than a typical CRUD app, thin at the top (critical journeys only, no visual
regression — DaisyUI/Tailwind styling churn would make screenshot baselines
high-maintenance for low signal).

```
Unit (Vitest, pure fns)  →  Service (Vitest, fakes)  →  Component (targeted)  →  E2E (critical journeys)
```

## Layers

### 1. Unit — `tests/unit/*.test.ts`, Vitest, Node/jsdom environment

Pure functions only: parsers (`beancountParser`, `ledgerParser`,
`rledgerParser`, `transactionParser`), `voiceNlp`, `numberUtils`, `formatter`,
`sync-queries`, `scheduledTransactions`, asset-allocation validation/
serialization. No mocking of app internals — if a function needs a fake to
test, it belongs in the service layer instead.

Config: `vitest.config.ts` (separate from `vite.config.ts` — the PWA/dev-server
plugins there don't apply to tests and fight Vitest's transform pipeline).
`tests/setup.ts` stubs three things modules rely on at import time that
don't exist (or don't perform) in Vitest's Node/jsdom environment:

- `Worker` — `LedgerWorkerClient` spawns one eagerly in its constructor;
  tests that only need the module graph to load (not run a real worker) get
  a no-op stub.
- WASM asset fetch — `@rustledger/wasm` inits via `fetch(wasmUrl)`; Vite's
  `?url` import resolves to a path Node's `fetch` can't dereference directly.
  The setup intercepts `.wasm` requests and serves the real bytes from disk,
  so `rustledger.ts` tests exercise the **actual WASM parser**, not a mock —
  this is a real integration test running fast inside the unit layer.
- `@lucide/svelte` — the package barrel re-exports ~1700 individual icon
  components. Per [lucide-icons/lucide#2806](https://github.com/lucide-icons/lucide/issues/2806),
  importing even one icon from the barrel forces evaluation of all of them —
  10x dev-server reload slowdown, and 30s+ per import under Vitest (no
  pre-bundling), blowing past any test timeout. Every icon is globally
  mocked to a trivial `<svg>` stub (`tests/mocks/IconStub.svelte`) via a
  `Proxy` in `tests/setup.ts`. **This blocks every component test** — any
  component importing an icon hangs without it. Tests assert on
  behavior/markup structure, never on which icon glyph rendered. Production
  code is untouched; migrating the 69 call sites to deep imports
  (`@lucide/svelte/icons/circle-alert`) would also fix the real dev-server
  slowdown but is a separate, larger refactor — not done as part of this.

Run: `npm run test:unit` (or `test:unit:watch` while iterating).

### 2. Service — same Vitest config, `tests/unit/*.test.ts`

Services that orchestrate storage (`appService`, `accountsService`,
`backupService`, `cloudBackupService`) get tested against fakes at the
existing seams, not real OPFS/IndexedDB:

- `storageBackend.ts` is already an interface over OPFS — implement an
  in-memory fake for tests instead of hitting real File System Access APIs.
- Dexie/IndexedDB access → `fake-indexeddb` (not yet installed; add when the
  first service test needs it — don't install speculatively).

Keep these fast and hermetic. If a test needs a real browser API with no
practical fake, it's an E2E concern, not a service test.

### 3. Component — targeted only, `@testing-library/svelte`

Not every component gets a test. Write one only for components with real
interactive state/logic, e.g. `XactEditor`, `PostingEditor`, `ScheduleEditor`,
`SearchableSelect`, `DragReorderList`. Skip pure-display components (cards,
rows, badges) — they're cheaply covered by the E2E smoke tests that render
the pages containing them.

Location: `tests/components/ComponentName.test.ts`. See
`tests/components/PostingEditor.test.ts` for the established pattern: seed
the relevant `mainStore` stores in `beforeEach` (components read/write them
directly rather than taking data as props), `vi.mock('$app/navigation')` for
any `goto` calls, assert on both DOM state and resulting store state.

### 4. E2E — `tests/e2e/*.spec.ts`, Playwright, critical journeys only

Scope is deliberately narrow: verify the app shell and critical pages render
against a real production build (`npm run build && npm run preview`), plus
a handful of full user journeys end to end. No per-route exhaustive coverage,
no visual regression.

Current critical journeys (`tests/e2e/critical-journeys.spec.ts`):

- Home page renders (toolbar + quick-entry FAB)
- Quick-entry FAB → transaction search navigation
- Journal, Reports, Settings, Accounts, Scheduled Transactions, Favourites
  pages render their toolbar title

**Not yet covered** (needs seeded OPFS/IndexedDB fixture data — add as a
follow-up once a fixture-seeding helper exists, don't fake it with an empty
ledger):

- OPFS import/sync round-trip
- WebDAV backup/restore round-trip
- Full quick-transaction-entry → journal-shows-it flow
- Scheduled transaction execution

Run: `npm run test:e2e`.

## Conventions

- Test files under `tests/unit/` and `tests/components/` are Vitest
  (`*.test.ts`); files under `tests/e2e/` are Playwright (`*.spec.ts`).
  `vitest.config.ts` excludes `tests/e2e/**`; `playwright.config.ts` points
  `testDir` at `tests/e2e`.
- Fixture `.bean` files live in `tests/data/`.
- A bug fix gets a regression test at the layer closest to where the bug
  actually lived (parser bug → unit test; storage bug → service test with a
  fake; only a rendering/navigation bug goes to E2E).
- No CI yet. `npm run verify` chains `lint → check → test:unit → test:e2e`.
  `npm run publish` runs `verify` then `deploy` — that's now the actual
  gate: use `publish` to ship, not `deploy` directly. `deploy` remains the
  raw Netlify push for cases where you deliberately want to skip the gate.

## Deliberately out of scope (for now)

- CI/GitHub Actions — revisit once the suite is established and stable.
- Visual regression testing — DaisyUI/Tailwind styling churn makes
  screenshot baselines high-maintenance for the signal they'd provide here.
- Broad component-test coverage — targeted only, see Layer 3.
- Exhaustive per-route E2E smoke tests — critical journeys only; the 60+
  routes not covered are a known gap, not an oversight.
