# Scalable Capital importer (MCP)

## Status (2026-11-25)

- Done: MCP connection end-to-end — the JSON-RPC client (`src/lib/importers/scalable/mcp.ts`) talks to `https://mcp.scalable.capital/mcp` through the same-origin proxy (`/api/proxy`), the importer is registered as an API source on the Importers page, and the live data view at `/importers/scalable` shows overview, cash & buying power, holdings and the transaction list. Unit tests cover the handshake, session handling, auth and the proxy MCP path (see Tests).
- Done, with a caveat: authentication. The initial in-PWA OAuth flow (callback route `src/routes/importers/scalable/callback/+page.svelte` + `oauth.ts`) was removed — a hosted PWA cannot receive the `http://localhost` redirect, so Cashier cannot authenticate with Scalable directly. The shipped flow is the localhost Python script: the user runs `scripts/scalable_token.py`, pastes the printed token JSON into the config form, and the tokens are stored device-only and refreshed via the `refresh_token` grant. See [Authentication for the Scalable Capital MCP endpoint](#authentication-for-the-scalable-capital-mcp-endpoint).
- Next: import the MCP transactions into the ledger through the review flow (option 2 under "Showing data / reports"), so the existing Reports cover Scalable automatically.

## Goal

Add a Scalable Capital source to the Importers page. Unlike the file-based importers (N26 CSV, IBKR Flex XML), it reads the account live from Scalable's official MCP endpoint. Authentication happens outside the PWA: a small Python script run on localhost performs the OAuth login and prints tokens that the user pastes into Cashier; the tokens are stored locally (device-only) and never synced or exported.

## Design

- **Endpoint**: `https://mcp.scalable.capital/mcp`, MCP Streamable HTTP transport, `Authorization: Bearer <access_token>`.
- **Authentication — OAuth 2.0 Authorization Code + PKCE, but driven by a localhost script, not the PWA** (verified against the live server's public metadata):
  - A hosted PWA cannot receive the OAuth redirect (no `http://localhost` redirect URI), so the login cannot run inside the app. Instead, `scripts/scalable_token.py` (stdlib-only, Python 3.10+) runs on the user's computer: it POSTs `/register` (RFC 7591 dynamic client registration, public client, `token_endpoint_auth_method: "none"`) with a `http://localhost:<port>/callback` redirect URI → `client_id`; builds the `/authorize` URL with PKCE S256 + state + the RFC 8707 `resource` parameter; opens it in the system browser — Scalable shows login + consent ("Connect Cashier to Scalable MCP?"); catches the code on the loopback port, verifies state, and POSTs it to `/token` (form-urlencoded, no client secret); then prints the tokens (`client_id`, `access_token`, `refresh_token`, `expires_in`, …) as JSON, ready to paste.
  - `/.well-known/oauth-authorization-server`: authorize/token/register endpoints, `code_challenge_methods_supported: ["S256"]`, scopes `openid profile offline_access`, grant types `authorization_code` + `refresh_token`. `/.well-known/oauth-protected-resource/mcp`: resource = `https://mcp.scalable.capital/mcp`.
  - The app offers the script for copying: `ScalableConfigForm.svelte` shows it (raw-imported from `scripts/scalable_token.py` via `tokenScript.ts`, so there is a single source of truth) with a **Copy script** button. The user pastes the script's JSON output into the form; `parsePastedTokens`/`savePastedTokens` (`auth.ts`) validate it and store it in **device-only** settings (`DeviceSettingKeys.scalableTokens`, key `importer.scalable.tokens`). `ScalableAuth` (the `McpTokenSource`) refreshes expired access tokens proactively and on 401 (the MCP client retries once) using the stored `client_id` + `refresh_token` via the `refresh_token` grant (`token.ts`, POST through the proxy).
- **Transport**: the browser cannot reach the endpoint directly (CORS), so all calls go through the app's same-origin proxy (`/api/proxy`, `worker/proxy.ts`). The host is in `ALLOWED_HOSTS`, `UPSTREAM_BEARER_HOSTS` (token forwarded as `Authorization`, like the Mistral speech key) and `POST_HOSTS` (JSON-RPC and the refresh form post). `MCP_HOSTS`: the proxy sends the MCP `Accept: application/json, text/event-stream`, forwards the client's `X-Upstream-Session-Id` as `Mcp-Session-Id`, and passes an upstream `Mcp-Session-Id` response header back (`worker/proxy.ts`, `proxyProtocol.ts`, `proxyFetch.ts`).
- **Client**: `src/lib/importers/scalable/mcp.ts` — minimal JSON-RPC client: `initialize` → `notifications/initialized` → `tools/call` / `tools/list`, session-id handling, JSON and SSE response parsing, `structuredContent`/text-content unwrapping, 401 → refresh + retry once. Typed read-only wrappers in `api.ts`.
- **Credentials**: tokens live in device-only settings — the same pattern as the Mistral API key. The synced importer config (`importer.scalable`, `config.ts`) holds only `portfolioId`.
- **Importer registration**: `scalableImporter` in `scalable.ts`, registered in `src/lib/importers/index.ts`. The `Importer` interface gained `source: 'file' | 'api'` and `viewRoute`; the Importers page shows **View data** (→ `/importers/scalable`) instead of **Import file** for API importers, and a form editor (`ScalableConfigForm.svelte`) with the script viewer/copy button, the token-paste field, and a portfolio picker.
- **Data view**: `src/routes/importers/scalable/+page.svelte` — portfolio overview (valuation, performance by timeframe), cash & buying power, holdings table (price, value, FIFO, gain), and a filterable, paginated transaction list with per-transaction details.

### Authentication for the Scalable Capital MCP endpoint

The first MCP-backed source (Scalable Capital)
cannot authenticate from inside the PWA: OAuth 2.0 Authorization Code + PKCE needs a
`http://localhost` redirect, which a hosted page cannot receive. Workaround: the user runs
`scripts/scalable_token.py` on their computer (the app offers it via a **Copy script** button),
which does the loopback login and prints the tokens as JSON; the user pastes that JSON into
Cashier, where it is stored device-only and refreshed via the `refresh_token` grant.
If a future standard (e.g. a PWA-compatible browser flow or device-code grant) fits better,
re-evaluate here.

## Showing data / reports — options considered

1. **Dedicated view (shipped)**: render MCP data directly in `/importers/scalable`. Immediate, no book coupling; downside: duplicates what the book already knows and does not persist.
2. **Import into the ledger (later)**: map `list_portfolio_transactions` (buys/sells/distributions/transfers) and holdings to Beancount transactions via the existing review flow (like the IBKR importer), so the existing Reports (portfolio returns, cost vs market, tax summary) cover Scalable automatically. The `Importer` interface would need an async fetch-to-`ImportedXact[]` path; dedup against the broker cash account as with IBKR. This is the natural next phase — the MCP data shapes for it are already typed in `api.ts`.
3. **Hybrid**: keep the live view for a quick look, add an "Import transactions" action that funnels MCP transactions through the review screen (option 2) on demand.

## Open questions

- `simpleAbsoluteReturn` in the overview is shown as a percentage; confirm against a known portfolio whether the endpoint ever returns fractions (the Wealth overview documents fractions explicitly, the broker overview does not).
- Transaction `statuses`/`transactionTypes` filter values are normalized server-side from loose input; the view currently filters client-side to avoid depending on the enum.
- MCP session lifetime/DELETE termination is not implemented — the server expires sessions on its own; the client re-initializes when a call fails with 404.

## Tests

- `tests/unit/scalableMcp.test.ts` — handshake, session reuse, JSON/SSE parsing, content unwrapping, 401 refresh-retry, error mapping.
- `tests/unit/scalableAuth.test.ts` — parsing the script's JSON output (incl. `expires_at`/`expires_in`, validation errors), device-only storage, the refresh_token grant form post, proactive refresh + re-login error.
- `tests/unit/proxy.test.ts` — MCP host: POST allowed, bearer + session forwarding both ways, MCP Accept header, non-MCP hosts unaffected.
