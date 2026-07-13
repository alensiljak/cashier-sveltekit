# Portfolio Returns (IRR / MWRR)

Add a Portfolio Returns report to Cashier, modeled on
[fava-portfolio-returns](https://github.com/andreasgerstmayr/fava-portfolio-returns), which leverages [beangrow](https://github.com/beancount/beangrow) to compute money-weighted (IRR/XIRR) returns per investment.

beangrow itself is Python-only; rustledger's WASM engine has no port of it. This is a
from-scratch TS implementation on top of `fullLedgerService` (BQL + directives), not a port of beangrow's code.

## Method

Per investment group (a set of accounts sharing a commodity/strategy, e.g. one brokerage account or an asset class):

1. **Classify postings** into external cash flows vs. internal activity:
   - Internal: a posting on the group's own accounts (already reflected in market value), or
     on an `Income:`/`Expenses:` account (dividends, interest, fees) — never a cash flow.
   - External: everything else, including a shared broker cash account funding buys/sells
     across multiple symbols — a buy/sell against it carries the full flow amount at the
     moment cash converts into (or out of) this specific holding.
2. **Build the cash-flow list**: `(date, amount)` pairs, negative = money in, positive = money out, plus:
   - synthetic flow at the start date = −(opening market value)
   - synthetic flow at the end date = +(closing market value), priced via the price map
3. **Solve for IRR** (XIRR): find `r` such that
   `Σ amount_i / (1+r)^(days_i/365) = 0`, via Newton-Raphson with bisection fallback.
4. Report per-group IRR, and roll up to portfolio level.

This is MWRR — timing and size of each flow affects the discount rate solved for, unlike TWR which chains sub-period returns and ignores flow size.

## Tasks

### Config — done

- [x] Investment groups are derived from the existing Asset Allocation definition, not a new config schema: one group per leaf asset class (an `AssetClass` with `symbols` set).
      Group accounts = investment accounts (from `loadInvestmentAccounts`) whose held
      commodity is in the asset class's `symbols`. This is the same
      `account.balance.currency === symbol` matching already used by the Asset Allocation and Asset Class Detail pages, so a group's accounts always agree with what those pages show.
      Implemented: `src/lib/portfolioReturns/investmentGroups.ts` —
      `deriveInvestmentGroups(assetClasses, investmentAccounts): InvestmentGroup[]`
      (`{ name, symbols, accounts }`). Rollup-only asset classes (no symbols) and asset classes with no matching account balance are dropped — nothing to report.
      Tests: `tests/unit/investmentGroups.test.ts`, 5/5 passing.
- [x] Report window (not a per-group setting) reuses `YearPeriodSelector`
      (`src/lib/components/YearPeriodSelector.svelte`), same as Net Worth / Cost vs Market / Running Balance: "Last 12 months" or a specific calendar year, resolved to a start/end date. A group has no separate "start date" — the synthetic opening flow is simply the group's market value at the window start (0 if the group didn't exist yet), so since-inception behavior falls out automatically for groups younger than the window.

### Data extraction & Flow classification — done

- [x] Implemented: `src/lib/portfolioReturns/cashFlows.ts` —
      `extractAllGroupFlows(queryFn, groups, reportCurrency, startDate, endDate):
Map<groupName, GroupFlowsResult>`, batching every group into 4 BQL queries total
      (2 market-value date points, 1 id-discovery query, 1 postings query) instead of 4 per
      group. `extractGroupFlows(queryFn, group, ...)` is a single-group convenience wrapper
      around it.
      **Performance rewrite, not just an optimization**: the original per-group version
      (4 full-ledger BQL scans × group count) worked on the 3-group demo book but hung on a
      real multi-level asset-class tree with dozens of leaf groups — each scan is O(ledger
      size) against a single-threaded WASM worker, so per-group querying was O(groups ×
      ledger size). Batched: 1 combined market-value query per date point (`GROUP BY
account`, summed client-side per group), 1 combined id-discovery query across every
      group's accounts (a transaction touching two groups' accounts, e.g. a rebalance, is
      recorded against both), 1 combined postings query over the union of ids. Total query
      count is now O(1) in the number of groups.
      Confirmed same output as the per-group version on the demo book (11.4% / 2.0% / 42.9%
      for Equity/Bonds/Cash) before and after the rewrite.
      Per-posting classification (unchanged): internal if the account is one of
      `group.accounts`, or an `Income:`/`Expenses:` account; external otherwise. No widened
      "boundary subtree" — a shared broker cash account is deliberately always external,
      since cash isn't attributable to any one group until a buy/sell actually converts it
      into that group's holding; that conversion is what carries the flow. (An earlier
      version widened the boundary to a group's account subtree so a _dedicated_ per-group
      cash sub-account would net to zero on a same-transaction buy — reverted: real books
      here use one shared cash account per broker across all securities, and widening caused
      a single deposit to be double-counted as a contribution to every symbol sharing that
      cash account.)
      **`id` is a numeric BQL column, not a string** — an earlier version quoted ids like
      every other filter in this module (`id IN ('32', '72')`), which silently matched
      nothing, so every transaction flow was dropped and the IRR silently degraded to a
      plain opening→closing value delta (still a plausible-looking number, wrong because it
      ignores every contribution/withdrawal). Fixed: numeric ids are now emitted bare
      (`id IN (32, 72)`); confirmed against the demo book via `/reports/query`. Caught by
      browser smoke-testing, not by the mocked unit tests (a mock QueryFn can't catch a real
      BQL type-coercion mismatch) — verify any future change to this query against a real
      ledger, not just the test suite.
- [x] Synthetic opening/closing flows: `value(sum(position), 'CCY')`-via-`convert()` at
      day-before-start and at end, same `WHERE account IN (...) AND date <= ...` pattern the
      Net Worth report already uses for historical point-in-time balances — now
      `GROUP BY account` for the batched, multi-group query.
- [x] Multi-currency: every cash flow and market-value figure goes through BQL
      `convert(<amount>, '<reportCurrency>')`, relying on the WASM engine's price map —
      Cashier does no rate math itself. Per beancount semantics, `convert()` returns the
      value **unconverted, in its original currency** when no price path exists. Every
      converted amount's currency is checked against the report currency; a mismatch is
      collected into `GroupFlowsResult.conversionWarnings` (e.g.
      `"VXUS: no price to EUR (got USD)"`) rather than silently fed into the NPV. The report
      UI must surface these per-group and treat that group's IRR as unavailable, not just
      display a wrong number.
      Tests: `tests/unit/cashFlows.test.ts`, 9/9 passing (opening/closing synthetic flows,
      shared-cash buy as a full external flow, multi-leg same-transaction summing,
      Income-account exclusion, inter-group rebalance touching both groups at once,
      unconverted-currency warning, BQL error propagation, single-group wrapper delegation).

### XIRR solver — done

- [x] Implement Newton-Raphson NPV solver with bisection fallback: `src/lib/utils/xirr.ts` (`xirr(flows, guess?)`, `CashFlow { date, amount }`, throws `XirrNoSolutionError` on degenerate input).
- [x] Unit tests: `tests/unit/xirr.test.ts` — closed-form single-period rate, multi-flow series (NPV-zero check), order-independence, negative IRR (loss), extreme-gain case forcing the bisection fallback, degenerate-input errors (single flow, same-day flows, all-outflow, all-inflow), and a realistic multi-flow beangrow-style series. `npx vitest run tests/unit/xirr.test.ts` — 10/10 passing.

### Report UI — done

- [x] `src/routes/reports/portfolio-returns/+page.svelte`, windowed by `YearPeriodSelector`
      (last 12 months / calendar year) exactly like Net Worth and Cost vs Market. Groups are
      rendered as a tree (dotted asset-class names like `Allocation:Equity:Aus:market`
      nested into indented rows, pure-label header rows for non-leaf path segments) instead
      of a flat list, matching the Asset Allocation page's structure.
- [x] **Streams progressively instead of blocking on one combined result.**
      `src/lib/portfolioReturns/cashFlows.ts` exports the two BQL phases independently —
      `marketValuesForGroups()` (2 queries) and `transactionFlowsForGroups()` (2 queries) —
      plus a pure, synchronous `buildFullFlowSeries()` combinator. `extractAllGroupFlows()`
      (blocking on both) still exists for callers that don't need to stream.
      The page renders the full tree immediately once groups are derived (name only, each
      row showing a spinner), then updates every row's market value the moment
      `marketValuesForGroups()` resolves and every row's IRR the moment
      `transactionFlowsForGroups()` resolves — whichever finishes first paints first,
      instead of the whole page staying behind one spinner until both are done and every
      group's IRR is computed. Each phase still only issues its 2 queries once, batched
      across every group — this is a UI sequencing change, not a re-introduction of
      per-group querying.
      Tests: `marketValuesForGroups`/`transactionFlowsForGroups` are unit-tested to resolve
      independently (each mock only registers rules for its own queries — an unexpected
      query from the other phase throws "Unmatched BQL"), and `buildFullFlowSeries` is
      tested directly. `tests/unit/cashFlows.test.ts` — 13/13 passing.
- [x] **"All" period** (since-inception IRR — the other standard beangrow window besides
      per-year). `YearPeriodSelector` gained an opt-in `includeAll` prop (default off, so
      Net Worth / Cost vs Market / Running Balance are unaffected); Portfolio Returns passes
      it. Resolves to `startDate: '1900-01-01'`, `endDate: today` — no plausible ledger
      predates that, so the group's opening market value is 0 and `buildFullFlowSeries`
      naturally skips the synthetic opening flow (nothing precedes the window), same code
      path as any other period, no special-casing needed in `cashFlows.ts`. Smoke-tested:
      selecting "All" on the demo book reproduces the same 11.4%/2.0%/42.9% as "Last 12
      months" (expected — the demo book's entire history already fits inside 12 months).
- [ ] **Unverified**: performance against a real multi-level tree with dozens of leaf groups
      and years of history. The batching rewrite (4 total queries, not 4 × groups) is the
      fix for the reported hang, but only checked so far against the 3-group demo book —
      needs confirming against real data with the actual tree depth/transaction volume that
      triggered the original hang.

## Open questions

(none — multi-currency conversion is delegated to the WASM engine's `convert()` with
failures surfaced per-group, and the group-boundary question is resolved: no widening,
shared cash is always external, buys/sells carry the flow; see Data extraction & Flow
classification.)
