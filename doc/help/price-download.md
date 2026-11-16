# Price Download

Downloads prices into a Beancount prices file of your choice, by default `prices/prices.current.bean` in the app's storage. Providers can serve exchange rates (ECB daily reference rates, served CORS-enabled by [Frankfurter](https://frankfurter.dev)) or security prices (fund NAVs and ETF prices).

## Configuration

- **Provider** — where the prices come from. The provider dropdown lists the registered sources. Currency providers publish rates in a base currency (ECB is EUR-base); securities providers publish a price per commodity in the fund's quote currency.
- **Symbols** — the candidates the provider can serve from your book are listed with checkboxes. Untick any you do not want fetched or written; **All** restores the default (every book-relevant candidate, including ones the book starts using later), **None** fetches nothing. The selection is saved per provider alongside the other settings and shared between devices.
- **Proxy key** — only needed when the deployment protects its CORS proxy. The key is stored on this device only and sent as the `X-Proxy-Key` header; it is never included in the app bundle or exported with settings. Leave it empty when the proxy is not protected.
- **Destination file** — any path in the app's storage; existing `.bean` files are offered as one-tap shortcuts. The app never edits your book — once the file exists, wire it into your book yourself with an `include` directive, e.g. `include "prices/prices.current.bean"` placed in your main book file.
- **Append history** — off by default, the file is rewritten each run with just the latest prices ("current" prices). Turn it on to keep earlier downloaded prices and gradually build a price history; duplicates for the same date are deduplicated.

## What gets fetched

The provider determines the candidate set:

- **Currency providers** fetch only currencies relevant to your book: your default currency, the ledger's operating currencies, and the currencies appearing in your price directives and accounts. Securities declared in your book are not exchange rates and are left alone; currencies the provider does not serve are listed under the preview.
- **Securities providers** fetch the commodities declared in your book (`commodity` directives, with `ticker`, `isin` or `apir` metadata when the source needs it). Each price is written as `price <commodity> <rate> <quote currency>`; securities are never inverted.

If your book already keeps prices for a currency pair — say a `price USD 0.9 EUR` history — the new rates are written **in your series' direction**, extending it with new dates. Writing the opposite direction instead would be ignored by the ledger: for one pair it keeps only one of the two directions (the denser series wins), so this way your data stays the authority and the downloads stay effective.

The **Symbols** checkboxes narrow the candidate set before anything is fetched: only ticked symbols are requested from the provider and written to the destination file. The choice is stored per provider, so switching providers restores each one's own selection.

Some sources block browser requests with CORS. Those are fetched through the app's same-origin `/api/proxy` endpoint; the proxy only allows the source hosts the app's providers use.

## Running it

Press **Download latest prices**. The latest prices are written to the destination file and the ledger reloads in the background. The _Last run_ card shows the price date and counts.

Two devices that download the same prices write byte-identical file content, so file sync (S3/WebDAV) transfers nothing; a device with older prices produces an ordinary file change that you resolve by keeping one side or re-running the download.
