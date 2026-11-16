# CORS Proxy

## Background

Implementing price downloaders in Cashier requires fetching prices from various online sources. These are mainly closed-off with CORS policies, which makes them unavailable for a PWA application.

## Goal

Create a small worker that acts as a proxy for fetching web content.

## Design

One same-origin endpoint, used by every provider that needs it:

```
GET /api/proxy?url=<absolute https URL>
```

The response is the upstream body with its status and a safe content type. The proxy never rewrites the payload — providers parse the source's own JSON/CSV/XML.

### Allowlist plus a shared key

`worker/proxy.ts` exports `ALLOWED_HOSTS`, a static `Record<host, true>` of source hosts. Add a provider's host there when adding its downloader. The proxy rejects everything else with `403`, so the public endpoint cannot be used to fetch arbitrary URLs.

The host allowlist alone does not authenticate callers. The deployed Worker also requires the `PROXY_KEY` secret:

- Set it once with `wrangler secret put PROXY_KEY` (any high-entropy string).
- The client sends it as `X-Proxy-Key`; `proxyFetch()` reads the value from the device-only `proxy.key` setting, so it is never bundled into the app and is not exported or synced.
- The Worker compares it without short-circuiting on the first differing character. A missing or wrong key is `401`.
- If the Worker has no `PROXY_KEY` configured, every proxy request is `503` — the deployed proxy fails closed rather than silently becoming open.
- `vite dev` / `vite preview` do not require a key unless `PROXY_KEY` is set in the environment, so local work needs no extra setup. Set the same variable locally to exercise the key path.

This is a deployment-wide shared key, not per-user authentication. It stops casual use of the endpoint and makes the key rotatable without redeploying; it does not distinguish individual users. For per-user access control, put Cloudflare Access in front of `/api/*`.

Current entries:

| Host                  | Used by                     |
| --------------------- | --------------------------- |
| `www.vanguard.com.au` | Vanguard AU fund/ETF prices |

### Request rules

- `GET` only; anything else is `405`.
- `https` only; credentials in the URL are rejected.
- No client headers are forwarded. `Origin`, `Referer` and `Cookie` are deliberately dropped: several sources reject foreign origins outright (Vanguard answers `500` when an `Origin` other than its own is present). The only client header read is `X-Proxy-Key`, and it is never forwarded upstream; the proxy sends only `Accept` and a neutral `User-Agent`.
- Redirects are not followed (`redirect: 'manual'`); a `3xx` becomes `502`.
- 15 s timeout (`AbortController`), mapped to `504`.
- Responses larger than 5 MB are rejected with `502`.
- Upstream error statuses and bodies pass through, so a provider sees the source's own failure.
- `Cache-Control: no-store`; price data is fetched fresh on each run.

### Deployment

The Worker entry is `worker/index.ts`. `wrangler.jsonc` binds the static build as `ASSETS` and routes `/api/*` to the Worker first:

```jsonc
"main": "worker/index.ts",
"assets": {
  "binding": "ASSETS",
  "directory": "./build",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"]
}
```

Every other request is served from the static SvelteKit build via `env.ASSETS.fetch(request)`.

Set the shared key once per deployment:

```sh
wrangler secret put PROXY_KEY
```

Without it, the deployed Worker answers every `/api/proxy` request with `503` (fail closed). The key is not in `wrangler.jsonc` or the repository.

### Local development

`vite.config.ts` registers the same `handleProxyRequest` as middleware for both `vite dev` and `vite preview`, so providers call one URL in every environment and the proxy is exercised by Playwright against the preview build. No separate `wrangler dev` process is needed.

### Provider integration

`src/lib/services/prices/proxyFetch.ts` exposes `proxyFetch(target)` (and `proxyUrl(target)` for tests). A provider that needs the proxy fetches through it instead of calling the source directly. CORS-enabled sources (ECB via Frankfurter) keep fetching directly.

## Provider prep shipped with the proxy

The price-download abstraction now supports both currency and securities providers:

- `PriceProvider.kind` is `'fx' | 'securities'`.
- `DeclaredSecurity` carries `name`, `ticker`, `isin` and `apir` from the book's `commodity` directives. A securities provider implements `resolveSecurities()` to map them to its own catalogue and caches that mapping for `fetchLatest()`.
- `PriceQuote.date` is optional and per-quote. FX fixings share one date (`FetchedQuotes.asOf`); fund NAVs do not, so a securities provider sets each quote's publication date.
- The plan branches on `kind`: FX uses the existing currency derivation and direction handling; securities use `deriveSecuritySymbols()` and never invert (a fund NAV is always `commodity → quote currency`).
- Append mode drops the opposite direction of every pair written in the run, derived from the incoming directives — correct for FX native, FX inverted and securities pairs.

## Security model

The proxy is served from the same origin as the app, so no CORS headers are emitted and other websites' scripts cannot read its responses. Two layers protect the endpoint:

1. **Host allowlist** — only the price hosts Cashier actually uses. This is what keeps the endpoint from becoming a general open relay.
2. **Shared key** — the `PROXY_KEY` Worker secret, sent as `X-Proxy-Key`. The client reads it from the device-only `proxy.key` setting, so it is not in the public bundle and is not exported or synced. A missing or wrong key is `401`; a Worker with no `PROXY_KEY` configured fails closed with `503`.

The key is deployment-wide, not per-user: it stops casual use and unauthorized automated calls, and it can be rotated without rebuilding the app, but anyone who has the key can use the proxy. For per-user access control, put Cloudflare Access in front of `/api/*`.

The other layers are:

- https only, no URL credentials, no redirects followed, so a permitted host cannot bounce the request to an unlisted one.
- Client headers are never forwarded; the key header is consumed by the proxy, not sent upstream.
- Timeout and response size cap.
- Cloudflare's platform rate limits (see hardening below).

Non-browser clients with the key can still reach allowlisted price hosts, which are public data; without the key they get `401`.

## Implementation Steps

Status reflects the working tree; nothing here has been run through `npm run verify` yet.

1. [x] Proxy handler (`worker/proxy.ts`): allowlist, GET only, https only, no redirects, timeout, size cap, header hygiene.
2. [x] Worker entry and routing (`worker/index.ts`, `wrangler.jsonc`): `/api/*` to the Worker first, everything else from `ASSETS`.
3. [x] Local dev parity: `handleProxyRequest` registered as middleware in `vite.config.ts` for `dev` and `preview`.
4. [x] Client helper (`proxyFetch.ts`) and unit tests (`tests/unit/proxy.test.ts`, `tests/unit/proxyFetch.test.ts`).
5. [x] Shared-key enforcement: `PROXY_KEY` secret, `X-Proxy-Key` header, device-only setting, fail-closed Worker.
6. [ ] Hardening (see below).
7. [ ] Deploy to Cloudflare and confirm `/api/proxy` works in production, including a rejected non-allowlisted host and a missing/wrong key.
8. [ ] Update `/doc/architecture.md` with the Worker, the `/api/*` routing and the security model.
9. [ ] Run `npm run verify`.

### Hardening (optional, not yet done)

- **Cross-site browser guard:** reject requests with `Sec-Fetch-Site: cross-site` (and a foreign `Origin`, when present) with `403`. This is cheap, and it stops other sites from using the endpoint through a visitor's browser. It does not stop non-browser clients, and the allowlist covers those.
- **Rate limiting:** add a Cloudflare WAF rate-limit rule (or the Workers rate-limit binding) on `/api/proxy` per client IP, returning `429`.
- **Redirect handling:** currently any `3xx` becomes `502`. If a needed source redirects, follow a bounded number of hops and re-check each against `ALLOWED_HOSTS`.
- **Strip `Set-Cookie`** and other upstream headers from the response (the doc says "safe content type"; confirm only allowlisted headers pass).

## Limitations

- No POST/PUT; price sources are read-only.
- The key is shared by the deployment, not per-user. If a future provider needs a per-user secret (e.g. a user's own API key for a paid source), pass it from the client for that request only and never log it, or add a signed-token scheme.
- The allowlist is host-level and lives in code (`worker/proxy.ts`), so each new provider's host is added in the same change as its downloader and ships with the normal deploy. Tighten it to path prefixes if a source exposes sensitive endpoints on the same host.
- The shared key plus Cloudflare's platform rate limits are the abuse controls until WAF rate limiting is added.
- Hosting is tied to Cloudflare Workers with static assets. Other static hosts would need their own proxy.
