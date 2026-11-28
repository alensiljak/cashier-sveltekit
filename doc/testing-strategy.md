# Testing Strategy

## Context

Cashier is a data-dependent, GUI-heavy PWA (~110 routes) built on browser-only
APIs — OPFS, IndexedDB (Dexie), File System Access, Web Workers, WASM
(rustledger). Little traditional business logic, but a meaningful amount of
pure logic (parsers, formatters, sync/merge rules, importers, CRDT stores)
where a silent bug means **wrong money or lost data** — that's what to guard.

The pyramid is heavy on unit + service tests, thin at the top (critical
journeys only, no visual regression — DaisyUI/Tailwind churn makes screenshot
baselines high-maintenance for low signal).

```
Unit/Service (Vitest)  →  Component (targeted)  →  E2E (Playwright, demo book)
```

## Layers

### 1. Unit + service — `tests/unit/*.test.ts` (Vitest, jsdom)

Pure functions (parsers, formatters, price providers, sync/merge, importers,
reports) are tested directly. Services that orchestrate storage (`appService`,
`backup`, `cloudBackupService`, WebDAV/S3 sync, CRDT stores, …) are
tested against fakes at existing seams:

- `tests/helpers/memoryBackend.ts` — in-memory `storageBackend` instead of OPFS.
- `fake-indexeddb` — real in-memory IndexedDB for Dexie code.
- Other helpers in `tests/helpers/`: `factories`, `demoFixtures`, `queryMock`,
  `beancountExpected`.

Keep them fast and hermetic. If a test needs a real browser API with no
practical fake, it's an E2E concern.

Config: `vitest.config.ts` (separate from `vite.config.ts`, whose PWA/dev-server
plugins fight Vitest). `tests/setup.ts` stubs what doesn't exist in the test
environment:

- `Worker` — no-op stub (`LedgerWorkerClient` spawns one in its constructor).
- WASM fetch — `.wasm` requests are served from disk, so `rustledger` tests run
  the **real WASM parser**, not a mock.
- `indexedDB` — `fake-indexeddb/auto`.

**Lucide icons:** always deep-import (`@lucide/svelte/icons/circle-alert`),
never the barrel — it forces evaluation of ~1700 components (10x dev reload
slowdown, 30s+ per import under Vitest; see
[lucide#2806](https://github.com/lucide-icons/lucide/issues/2806)). Enforced by
`no-restricted-imports` in `eslint.config.js` and `.oxlintrc.json`. Icons render
for real in tests.

Run: `npm run test:unit` (`test:unit:watch` while iterating, `test:coverage`
for a v8 coverage report).

### 2. Component — `tests/components/*.test.ts` (`@testing-library/svelte`)

Targeted only: components with real interactive state/logic. Currently
`PostingEditor` and `SearchableSelect`; candidates: `XactEditor`,
`ScheduleEditor`, `DragReorderList`. Skip pure-display components — the E2E
route sweep covers them.

Pattern (see `PostingEditor.test.ts`): seed `mainStore` stores in `beforeEach`
(components read/write them directly rather than via props),
`vi.mock('$app/navigation')` for `goto`, assert on DOM and store state.

### 3. E2E — `tests/e2e/*.spec.ts` (Playwright)

Runs against a production build (`npm run build && npm run preview`, port 4173;
`PROXY_KEY` is set by the config). No visual regression.

`tests/e2e/fixtures.ts` provides:

- `demoPage` — a page with the built-in demo book loaded via onboarding (fresh
  OPFS/IndexedDB per test), so pages are exercised with real data.
- `errors` (auto) — fails any test that hits an uncaught page error or console
  error.

Specs: `critical-journeys` (app shell + route sweep + asset allocation),
`user-flows` (home overview, persistence across reload, device-transaction
edit/delete, scheduled transactions, search/BQL), `transaction-entry`,
`reconcile`, `backup-restore`, `sync-hub`, `price-download`,
`currency-converter`.

**Not yet covered:** OPFS import/sync round-trip; WebDAV/S3 round-trips against
a real server.

Run: `npm run test:e2e`.

## Conventions

- `tests/unit/` and `tests/components/` are Vitest (`*.test.ts`); `tests/e2e/`
  is Playwright (`*.spec.ts`). `vitest.config.ts` excludes `tests/e2e/**`;
  `playwright.config.ts` sets `testDir: 'tests/e2e'`.
- Fixture data lives in `tests/data/` (`.bean` files, IBKR Flex XML + expected
  output).
- A bug fix gets a regression test at the layer closest to the bug (parser →
  unit; storage → service with a fake; only rendering/navigation → E2E).

## Verification & CI

- `npm run verify` = `lint → check → test:unit → test:e2e`.
- `npm run publish` = `lint → check → test:unit → deploy` (no E2E; `deploy` is
  the raw `build && wrangler deploy`).
- GitHub Actions (`.github/workflows/ci-deploy.yml`): on PRs to `main` runs
  lint, check and unit tests (no E2E); manual `workflow_dispatch` deploys to
  Cloudflare after those pass.

## Out of scope

- Visual regression testing.
- Broad component-test coverage — targeted only.
- Exhaustive per-route E2E — the route sweep checks render + no errors only.
- E2E in CI — currently run locally via `verify`.
