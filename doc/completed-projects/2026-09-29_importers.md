# Importing Bank Statements in Cashier

## Goal

To import bank statements directly in Cashier. The reason is that rustledger only supports a very simple CSV import without any ability to transform the records. Implementing another importer in Python, with Beancount, broadens the surface for maintenance.

## To Do

- [x] modify payees
- [x] match categories / accounts
- [x] fix ibkr importer interest vs dividends choice: commodity metadata `distribution: "interest"` routes a security to the config's `interestAccount` (replaces the manual symbol list)
- [x] booking date vs value date: banks dates often lag
- [x] deduplication
- [x] save importer configuration in Settings (or JSON in OPFS)
  - [x] support backup
  - [x] support sync

## Design

- import presents the transactions before writing to the (CRDT) store. The whole batch can be scraped without leaving trace in the store.
- the whole statement is imported to CRDT store as one transaction.
- preview matched existing transactions

## IBKR Importer

### Source material

- Python importer: `\alens-importers\src\alens\importers\ibflex.py` (~1500 lines).
- Python config: `\beans\import\import.py` (maps 1:1 to a JSON config; templates `{symbol}`, `{currency}` carry over).
- Real-world input: `\beans\download\bean-import.xml`, expected output `extracted.bean` (same folder). 111 cash transactions, 5 trades, 143 positions, 4 cash balances. No FX, fees, broker interest, sells, or corporate actions.
- Small, case-specific tests: `\alens-importers\tests\*.xml` with the expected output in `*.xml.beancount`. Reuse these as the primary test suite. They already use a placeholder account ID (`A0001111`).

### What is imported

| XML section                                                   | Result                                                                                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `CashTransaction` Deposits/Withdrawals                        | cash <-> transfer account (`txfer-{CCY}`), payee "IB {CCY} Deposit"                                                                     |
| `CashTransaction` Dividends, Payment In Lieu, Withholding Tax | one transaction per distribution; tax lines merged in by (date, payee, type); tax reversals/adjustments kept as separate postings       |
| `CashTransaction` Fees, Commission Adjustment                 | fee transaction                                                                                                                         |
| `CashTransaction` Broker Interest Received/Paid               | interest transaction to the broker interest account                                                                                     |
| `Trade` stocks                                                | Buy: `{price CCY}` cost. Sell: one posting per `Lot` + capital gains posting. Fee and cash postings. Same-day/symbol/price buys merged. |
| `Trade` forex (`USD.CHF`)                                     | multi-currency transaction with price, merged per day and pair                                                                          |
| `CashReport`                                                  | cash `balance` assertions at `toDate + 1` (`Xact.balanceAssertion`)                                                                     |
| `OpenPositions`                                               | stock `balance` assertions at `toDate + 1`                                                                                              |
| `CorporateActions`                                            | **out of scope for now**: warn and show as unsupported; handled in a separate project                                                   |

### Design decisions

- **Fits the existing framework**: a second `Importer<IbkrConfig>` registered in `src/lib/importers/index.ts`. `identify` checks for `<FlexQueryResponse `. ISIN -> symbol comes from `ImportContext.isinToSymbol` (replaces `get_isins.py`). Config lives in Settings (`importer.ibkr`), so backup and sync work.
- **Interest vs dividends**: distributions are income, regardless of type. The config has one distribution account template (e.g. `Income:Investment:Distribution:IB-Aus:{symbol}`) and the 50-entry `interest_symbols` list goes away. If a split is needed later (Australian tax), add a `distribution` metadata value on the commodity directive (like `isin`), read into the import context, and route by it. This is a later, optional step.
- **Dedup**: importers may provide their own dedup strategy; the importer interface gets an optional `findDuplicates`. Without one, the default in `dedup.ts` applies. IBKR uses the Python rule: same date (exact) and same set of (account, amount to 2 decimals, currency), one-to-one. The default (single bank account, +-3 days) stays as is, as it suits bank statements. Revisit only if real use shows problems.
- **Numbers**: `Posting.amount` stays a JS `number`; the model is not changed (it is persisted in the CRDT, used across the app, and changing it is a much bigger project). Inside the importer, all sums and scaling (merging dividend+tax, merging same-day trades, forex rate = amount/amount) use an integer-based decimal helper (BigInt mantissa + scale, building on `addDecimalStrings` in `numberUtils.ts`), and the result is converted to `number` only at the end, rounded to the precision needed. Amounts are read from the XML as strings, never via float arithmetic. Tests compare formatted output, so float noise (`0.30000000000000004`) is caught.
- **XML parsing**: a typed reader over `DOMParser` (`src/lib/importers/ibkr/flexXml.ts`). Vitest already runs under jsdom, so no new dependency. `DOMParser` does not exist inside a Web Worker; the review screen currently runs `extract` on the main thread, so this is fine, but a move to a worker would need another parser. Only `yyyy-MM-dd` dates are accepted; other formats give an error telling the user to change the Flex Query setting.
- **Dropped from the Python**: the holdings map (`use_existing_holdings` is hard-coded `False`; used only by corporate actions), unused helpers (`convert_date`, `get_balance_assertion_date`), commented-out code.

### Test data

- The 20 fixtures in `\alens-importers\tests\` (`*.xml` + expected `*.xml.beancount`) are the test suite. They already use the placeholder account `A0001111`. Copy them into the repo's fixture location (`src/lib/importers/__fixtures__/ibkr/` unless there is a convention), after a search for identifying text (account ID, names, paths).
- `bean-import.xml` (the real report) is **not** added to the repo. It is a reference for picking up real record shapes only; a case taken from it goes in as a small, hand-reduced fixture with placeholder account and no identifying amounts.
- The expected `.beancount` files are Beancount text; the TS tests compare against them after parsing, ignoring order and comparing amounts at 2 decimals. In the Python tests the same file is also the "existing entries" for dedup; in TS, dedup gets its own tests.
- **Rule: no guessing.** Behaviour is implemented only for record types we have real data for. For anything else the importer reports "not supported yet: <record>" to the user, and implements it when a real record is available.

#### Coverage of the existing tests

Covered: deposits, dividends, tax merge/reversal/adjustment, interest distribution, dual-listed ISIN and shared ticker, decimal formatting, broker interest received, commission adjustment, stock buys (+ tax and commission, merge), forex and forex merge, cash and stock balances, identify/MIME.

Gaps and decisions:

| Case                                                          | Decision                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Payment In Lieu of Dividends (incl. reversal)                 | Implement. Real record exists in `bean-import.xml`; add a reduced fixture.                                                            |
| Broker interest paid                                          | Implement (same code path as received); add a fixture.                                                                                |
| `Fees` cash transactions                                      | Implement (same path as Commission Adjustment); add a fixture.                                                                        |
| Fee currency differs from trade currency                      | Fix the Python label bug; unit test with a synthetic record.                                                                          |
| Unknown symbol (ISIN not in the map)                          | Decide one behaviour for all record types (warn, fall back to the ticker, mark `!`), instead of the Python mix of raise and fallback. |
| Stock sell with `Lot` rows                                    | **Not supported yet**: notify. No real record; the Python relies on the holdings map and on lot matching by date in Beancount.        |
| Forex trade with non-zero commission                          | **Not supported yet**: notify.                                                                                                        |
| Corporate actions (split, merger, issue change, rights issue) | **Not supported yet**: notify. Separate project.                                                                                      |
| IBKR dedup                                                    | New tests, written with the strategy.                                                                                                 |

### Phases

1. [x] Fixtures: the 20 cases are in `tests/data/ibkr/`; golden-file harness in `tests/helpers/beancountExpected.ts` (self-tested in `tests/unit/ibkrHarness.test.ts`). Amounts are compared exactly, not rounded. `div-interest.xml.beancount` was changed to the single-income-account rule.
2. [x] XML reader (`flexXml.ts`) and decimal helper (`src/lib/utils/decimal.ts`, half-even rounding like Python), with unit tests.
3. [x] Symbol resolution (`ibkr/symbols.ts`, `SymbolMap`: ticker/ISIN disambiguation, dual listings). The context gets `symbolIsins` (all symbol/ISIN pairs of the book, `loadSymbolIsins()` in `existing.ts`) and `warnings`.
4. [x] Cash transactions (`ibkr/cashTransactions.ts`, config type in `ibkr/config.ts`): deposits, dividends and payment in lieu with the tax merge, reversals/adjustments, fees, broker interest. 12 fixtures pass (balance lines excluded until phase 6). Unknown row types and unknown symbols warn; a missing transfer account leaves the deposit on the placeholder account, flagged `!`.
   - The `Other Fees` row type name is taken from the ibflex library; no real record or fixture has it yet.
   - Fees use the Python payee "IB Commission Adjustment" for both fee types.
5. [x] Trades (`ibkr/trades.ts`): stock buys (same day/symbol/price merged), forex + merge (amounts rounded to 4 decimals, rate to 5). Sells, forex with commission and non-ExchTrade pair-like rows (`TCF.RTS0`) create nothing and warn. 9 tests pass, all 4 trade fixtures.
   - A zero fee creates no fee posting (the Python always wrote one).
   - Buys merge only if the `tradeDate` (cost date) is also equal.
6. [x] Balance assertions (`ibkr/balances.ts`): cash per currency (`BASE_SUMMARY` skipped) and stock positions, dated `toDate + 1`. Unknown stock symbol: ticker fallback, `!`, warning. Wired into the importer; 3 tests, both fixtures pass.
   - The review screen's duplicate matching is still the default one, which does not understand balance rows; this is part of phase 7.
7. [x] Importer-specific dedup: optional `Importer.dedup` (`isRelevant` + `match`); IBKR rule in `ibkr/dedup.ts` (exact date, set of (account, amount to 2 decimals, currency), one-to-one, `Equity:Currency` ignored). Review screen loads all recorded transactions in the range (`loadExistingXacts`) and filters to the broker's accounts. Balance assertions are never flagged as duplicates (re-importing adds them again). 5 tests.
8. [ ] Config UI + review screen wiring; unsupported records reported to the user.
9. [ ] Later, separate project: corporate actions (split, merger, issue change, rights issue); optional `distribution` metadata.

### Open questions

- How are "not supported yet" records shown to the user? `extract` returns only `ImportedXact[]`. Options: a warnings list in `ImportContext` that the review screen displays, or a flagged placeholder row per unsupported record. Leaning towards a warnings list in the context, shown as a banner on the review screen.
- Sells with `Lot` rows, forex commission, and corporate actions wait for real records. Records that are not recognized are not created; a warning is added to the list instead (decided).
- **Tax reversal date (decided).** The Python put `date: <original dividend date>` on the tax posting; `Posting` has no metadata field. The TS version puts it in the transaction `meta` as `tax-reversal-date`, and the two fixtures (`tax-reversal`, `tax-adjustment`) expect that. Showing it in the review `details` as well can be added when the case comes up again.
- `forex-mix` contains a `TCF.RTS0` fractional-share trade (a wound-down ETF, handled manually) and a rights issue. The Python drops the trade silently (its symbol looks like forex but it has an ISIN, so it matches neither the forex nor the stock filter). The TS version creates no transaction for them and adds a warning for each (decided; rare, postponed).
