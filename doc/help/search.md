# Search

Search across payees, accounts, narration, and commodities in one box, backed by BQL queries against your full ledger.

## Scope

The pill toggle below the search box narrows results to one category — **Payees**, **Accounts**, **Narration**, or **Commodities** — or **All** (the default) to search every category at once.

## Prefixes

A term can carry a one-character prefix to pin it to a category, overriding the pill toggle for that term:

- `@term` — payee, e.g. `@Amazon`
- `#term` — account, e.g. `#Checking`
- `~term` — narration, e.g. `~refund`
- `$term` — commodity, e.g. `$VTI`

An unprefixed term follows the pill toggle's scope (or every category, under **All**).

Space separates multiple terms; every term must match (AND). A prefixed term filters _every_ active category, not just its own — e.g. `$VTI` under **All** narrows the Payees, Accounts, and Transactions sections to only those involving the VTI commodity, in addition to listing VTI itself under Commodities. `@Corner #Wallet` finds the payee "Corner Store" and the account "Wallet", but only because a transaction actually links them — the same AND condition drives every section.

Matching is case-insensitive and substring-based (not a whole-word match), matching every other search box in the app.

## Results

Results are grouped into sections — Payees, Accounts, Commodities, Transactions — each shown only when it has matches, with the matched text highlighted.

- **Payee**, **Account**, and **Commodity** results are entities: tapping one opens its [transactions](/help/payee-transactions) / [account transactions](/help/account-transactions) / [commodity detail](/help/commodity-detail) page.
- **Narration** results are full transactions (matched against their narration/payee/account text), shown in full — date, payee, narration, and every posting. Tapping one opens the same [transaction actions](/help/xact-actions) page you'd reach by tapping a transaction from a payee's transaction list.

## Session

Your search term and selected scope are kept for the session (not saved to disk) — navigating to a result and back leaves the previous search intact, but it resets on a full reload.
