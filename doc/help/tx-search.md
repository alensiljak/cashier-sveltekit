# Transaction Search

Transaction Search filters your ledger by date range, payee/narration, account, commodity, and amount, then lists every matching transaction. Tap a result to open its details.

## Filters

- **Date From** / **Date To** — restrict results to a date range.
- **Payee / Narration** — matches against either field.
- **Account** — matches the account name on any posting in the transaction.
- **Commodity** — matches the currency/commodity code on any posting.
- **Amount** — combine with `=`, `>`, or `<` to match a posting number exactly or within a range.

Leave a filter blank to skip it. The **generated query** box below the filters shows the underlying BQL so you can see exactly what will run.

## Regex matching

Payee/Narration, Account, and Commodity are matched as **regular expressions**, not plain substrings — a filter matches if the pattern is found *anywhere* in the field, not just at the start.

Anchors let you narrow that down:

- `^` pins the match to the start of the field.
- `$` pins it to the end.

So `VTI` matches any commodity containing "VTI" (including `VTI`, `VTIAX`, or a hypothetical `AVTIX`), while **`VTI$`** matches only commodities that *end with* "VTI" — excluding `VTIAX` but still matching `VTI`. Likewise `^VTI` would only match commodities that *start with* "VTI".

The same anchors work in the Payee/Narration and Account filters, e.g. `^Amazon` to match payees starting with "Amazon", or `Checking$` to match accounts ending in "Checking".
