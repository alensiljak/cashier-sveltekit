# Price Download

Downloads prices into a Beancount prices file of your choice, by default `prices/prices.current.bean` in the app's storage. Providers can serve exchange rates (ECB daily reference rates, served CORS-enabled by [Frankfurter](https://frankfurter.dev)) or security prices (fund NAVs and ETF prices).

## Providers

| Provider                                | Serves               | Needs the proxy? |
| --------------------------------------- | -------------------- | ---------------- |
| ECB reference rates (via Frankfurter)   | Currency rates (EUR) | No               |
| ECB reference rates (direct, via proxy) | Currency rates (EUR) | **Yes**          |
| Vanguard Australia                      | Fund NAVs and ETFs   | **Yes**          |

- **Via Frankfurter** works anywhere with no setup: [Frankfurter](https://frankfurter.dev) serves the same ECB fixings with CORS enabled, so the browser fetches them directly. It depends on that third-party service.
- **Direct** reads the ECB's own XML feed, which sends no CORS headers, so it is fetched through the app's `/api/proxy` endpoint and needs the proxy deployed and the **Proxy key** set (see below). Use it as a fallback if Frankfurter is unavailable.

## How it works

Prices are **book-driven**: each `commodity` directive in your book names its source with a Beancount `price` meta tag (`price: "AUD:yahoo/ASX:VHY"`), and the source name (its _nickname_) maps to a provider. Open a provider's **gear** icon to switch it on or off and manage its nicknames, source mapping and (for securities providers) the funds it prices. Disabled providers are hidden to keep the list short; choose **Show disabled providers** in the toolbar menu to list them, each with a switch to enable it again. Enabled providers without a nickname are always listed, greyed out. Nothing about which symbols are fetched is configured on the download page itself.

## The page

- **Providers** — every provider that has a nickname mapped to it, each with a checkbox. Tick the ones to download; their prices are combined into one file. **All** / **None** toggle every provider. Tap a provider's name to see which commodities it will fetch; the gear opens its settings. The selection is remembered.
- **Destination file** — any `.bean` path in the app's storage (not your main book). The app never edits your book — wire the file in yourself with an `include` directive, e.g. `include "prices/prices.current.bean"`.
- **Append history** — off by default: the file is rewritten with only the latest prices of the _ticked_ providers. Turn it on to keep earlier downloaded prices and build a history; duplicates for the same date are deduplicated.
- **Download** — each ticked provider shows its progress (waiting, fetching, done or failed), then the file is written and the ledger reloads in the background. **Preview output file** shows the destination's current contents, with a shortcut to open it in the file editor.
- **Needs attention** — Untagged, Unmapped source, Invalid and Not covered commodities, plus Ignored ones. These sections start collapsed and remember whether you opened them.

Destination, write mode, provider selection and nickname mappings are **shared across your devices**. The proxy URL and key are per-device and never synced: set them in [Settings](/help/settings) → Device Settings → **HTTP Proxy**. The key is sent as the `X-Proxy-Key` header and is only needed for providers that use the proxy.

Rates are written verbatim in each provider's published direction (ECB: `price EUR 1.61 AUD`).

## Vanguard Australia

Vanguard Australia identifies its products by **APIR** (managed funds) or **ASX ticker** (ETFs). The catalogue publishes no ISIN for managed funds, so `isin:` cannot be used to match them.

Link each commodity to its Vanguard product explicitly with `apir:` or `ticker:`:

```beancount
2020-01-01 commodity VAN0004AU
  name: "Vanguard Australian Property Securities Index Fund"
  apir: "VAN0004AU"

2020-01-01 commodity VAS
  name: "Vanguard Australian Shares Index ETF"
  ticker: "VAS"
```

The commodity name is the base of the downloaded price (`2026-11-16 price VAN0004AU 0.9736 AUD`); the metadata is the identifier Vanguard's catalogue is searched by. A commodity with neither `apir:` nor `ticker:` is listed as skipped, even when its name looks like a Vanguard code. Codes are matched exactly as published (uppercase).

The provider downloads the fund's published NAV, not the ASX market price, so ETF quotes may differ slightly from the exchange close.

Some sources block browser requests with CORS. Those are fetched through a proxy — by default the app's same-origin `/api/proxy` endpoint, or the custom **Proxy URL** from Settings → Device Settings → **HTTP Proxy**. The proxy only allows the source hosts the app's providers use.

Two devices that download the same prices write byte-identical file content, so file sync (S3/WebDAV) transfers nothing; a device with older prices produces an ordinary file change that you resolve by keeping one side or re-running the download.
