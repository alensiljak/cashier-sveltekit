# Price Download

Downloads exchange-rate reference prices (ECB daily reference rates, served CORS-enabled by [Frankfurter](https://frankfurter.dev) — the ECB's own feed cannot be fetched by a browser) into a Beancount prices file of your choice, by default `prices/prices.current.bean` in the app's storage.

## Configuration

- **Provider** — where the rates come from. The ECB rates are EUR-base, but you do not need EUR pairs for a specific direction: the ledger engine inverts and chains prices on lookup, so a single `price EUR 1.1052 USD` directive serves both EUR→USD and USD→EUR conversions.
- **Destination file** — any path in the app's storage; existing `.bean` files are offered as one-tap shortcuts. The app never edits your book — once the file exists, wire it into your book yourself with an `include` directive, e.g. `include "prices/prices.current.bean"` placed in your main book file.
- **Append history** — off by default, the file is rewritten each run with just the latest fixing ("current" prices). Turn it on to keep earlier downloaded fixings and gradually build a price history; duplicates for the same date are deduplicated.

## What gets fetched

Only currencies relevant to your book: your default currency, the ledger's operating currencies, and the currencies appearing in your price directives and accounts. Securities declared in your book (commodity directives with a ticker or ISIN) are not exchange rates and are left alone; currencies the provider does not serve are listed under the preview.

If your book already keeps prices for a pair — say a `price USD 0.9 EUR` history — the new rates are written **in your series' direction**, extending it with new fixing dates. Writing the opposite direction instead would be ignored by the ledger: for one pair it keeps only one of the two directions (the denser series wins), so this way your data stays the authority and the downloads stay effective.

## Running it

Press **Download latest rates**. The latest ECB fixing (published around 16:00 CET each business day — before that, the previous business day's fixing is returned) is written to the destination file and the ledger reloads in the background. The _Last run_ card shows the fixing date and counts.

Two devices that download the same fixing write byte-identical file content, so file sync (S3/WebDAV) transfers nothing; a device with an older fixing produces an ordinary file change that you resolve by keeping one side or re-running the download.
