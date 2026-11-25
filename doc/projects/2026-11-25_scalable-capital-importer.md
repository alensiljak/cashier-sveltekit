# Scalable Capital importer (MCP)

## Goal

Add a Scalable Capital source to the Importers page. Unlike the file-based importers (N26 CSV, IBKR Flex XML), it reads the account live from Scalable's official MCP endpoint. The user authenticates in the browser (OAuth login at Scalable); the resulting tokens are stored locally (device-only) and never synced or exported.

## Design

- **Endpoint**: `https://mcp.scalable.capital/mcp`, MCP Streamable HTTP transport, `Authorization: Bearer <access_token>`.
- **Authentication — OAuth 2.0 Authorization Code + PKCE with dynamic client registration** (verified against the live server's public metadata):
  - `/.well-known/oauth-authorization-server`: authorize/token/register endpoints, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]` (public client), scopes `openid profile offline_access`, grant types `authorization_code` + `refresh_token`.
  - `/.well-known/oauth-protected-resource/mcp`: resource = `https://mcp.scalable.capital/mcp` (sent as the RFC 8707 `resource` parameter on authorize and token requests).
  - Flow (`oauth.ts` + `auth.ts`): POST `/register` with the app origin's callback URI (`<origin>/importers/scalable/callback`) → `client_id`; build the `/authorize` URL with PKCE S256 + state; open it in the browser (`window.location.assign`) — Scalable shows login + consent ("Connect Cashier to Scalable MCP?"); the callback route verifies state and POSTs the code to `/token` (form-urlencoded, no client secret); access + refresh tokens are stored in **device-only** settings (`DeviceSettingKeys.scalableOAuth`). `ScalableAuth` (the `McpTokenSource`) refreshes expired access tokens proactively and on 401 (the MCP client retries once).
- **Transport**: the browser cannot reach the endpoint directly (CORS), so all calls go through the app's same-origin proxy (`/api/proxy`, `worker/proxy.ts`). The host was added to `ALLOWED_HOSTS`, `UPSTREAM_BEARER_HOSTS` (token forwarded as `Authorization`, like the Mistral speech key) and `POST_HOSTS` (JSON-RPC and OAuth form posts). New `MCP_HOSTS` list: the proxy sends the MCP `Accept: application/json, text/event-stream`, forwards the client's `X-Upstream-Session-Id` as `Mcp-Session-Id`, and passes an upstream `Mcp-Session-Id` response header back (`worker/proxy.ts`, `proxyProtocol.ts`, `proxyFetch.ts`).
- **Client**: `src/lib/importers/scalable/mcp.ts` — minimal JSON-RPC client: `initialize` → `notifications/initialized` → `tools/call` / `tools/list`, session-id handling, JSON and SSE response parsing, `structuredContent`/text-content unwrapping, 401 → refresh + retry once. Typed read-only wrappers in `api.ts`.
- **Credentials**: tokens live in device-only settings — the same pattern as the Mistral API key. The synced importer config (`importer.scalable`, `config.ts`) holds only `portfolioId`.
- **Importer registration**: `scalableImporter` in `scalable.ts`, registered in `src/lib/importers/index.ts`. The `Importer` interface gained `source: 'file' | 'api'` and `viewRoute`; the Importers page shows **View data** (→ `/importers/scalable`) instead of **Import file** for API importers, and a form editor (`ScalableConfigForm.svelte`) with **Connect with Scalable Capital** (browser login) and portfolio picker.
- **Data view**: `src/routes/importers/scalable/+page.svelte` — portfolio overview (valuation, performance by timeframe), cash & buying power, holdings table (price, value, FIFO, gain), and a filterable, paginated transaction list with per-transaction details. Callback route: `src/routes/importers/scalable/callback/+page.svelte`.

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
- `tests/unit/scalableAuth.test.ts` — client registration, authorize URL + PKCE S256, code exchange / refresh (form posts), state mismatch, token storage + proactive refresh.
- `tests/unit/proxy.test.ts` — MCP host: POST allowed, bearer + session forwarding both ways, MCP Accept header, non-MCP hosts unaffected.
