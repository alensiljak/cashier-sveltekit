# Enable Banking importer

## Status (2026-11-25)

- Done: API client end-to-end against the sandbox — RS256 JWT signing with WebCrypto (`src/lib/importers/enablebanking/jwt.ts`), device-only credentials + sessions, the consent redirect flow with callback route `/importers/enable-banking/callback`, and the operations page at `/importers/enable-banking` (sessions, accounts, balances, transactions with date range, search and continuation-key paging). Unit tests cover the JWT signer, credential handling, the client, session storage and the proxy path for `api.enablebanking.com`.
- Next: import transactions into the ledger through the review flow (map `GET /accounts/{uid}/transactions` rows to transactions per connected account, dedup against the mapped bank account like the file importers), so the existing reports cover bank accounts automatically. Same follow-up as for the Scalable importer.

## Goal

Add an Enable Banking source to the Importers page. Unlike the file importers, it reads bank accounts live from the Enable Banking API (`https://api.enablebanking.com`; the same host serves sandbox and production — the registered application ID decides the environment).

## Design

- **Authentication**: Enable Banking issues no API key and has no token endpoint. Every request carries `Authorization: Bearer <JWT>`, an RS256 JWT signed with the app's private RSA key (the `<app-id>.pem` downloaded at registration), header `kid` = application ID, payload `{iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp}` (TTL ≤ 86400 s). The PWA signs JWTs in-browser with WebCrypto (`crypto.subtle`, RSASSA-PKCS1-v1_5/SHA-256 = RS256; PKCS#1 PEMs are wrapped into PKCS#8, the only format WebCrypto imports). Tokens are cached ~1 h (`EnableBankingTokenSource`).
- **Credentials**: application ID + private key PEM are pasted into the config form and stored in **device-only** settings (`DeviceSettingKeys.enableBankingCredentials`) — never exported or synced, same pattern as the Scalable tokens. Caveat shown in the UI: Enable Banking's docs advise keeping the key out of client apps; for the user's own app on their own device this matches the trust level of the other device-only credentials. Confirmed with the user for the sandbox app.
- **Consent flow (in-PWA, unlike Scalable)**: `POST /auth {access: {balances, transactions, valid_until}, aspsp: {name, country}, state, redirect_url, psu_type}` → the browser is sent to the returned `url` (Enable Banking + bank); the user returns to `redirect_url?code=…&state=…` — the app route `/importers/enable-banking/callback`, whitelisted exactly in the Control Panel (`<origin>/importers/enable-banking/callback`; the form shows it with a copy button). The callback verifies `state` against the pending record kept in `sessionStorage` (survives the full-page round trip), exchanges the code via `POST /sessions {code}`, and stores the session (id + accounts) in device-only settings (`enableBankingSessions`). `DELETE /sessions/{id}` revokes.
- **Transport**: all calls go through the same-origin CORS proxy (`/api/proxy`, `worker/proxy.ts`). `api.enablebanking.com` is in `ALLOWED_HOSTS`, `UPSTREAM_BEARER_HOSTS` (JWT forwarded as `Authorization`) and `POST_HOSTS` (`/auth`, `/sessions`); a narrow `DELETE_HOSTS` list allows DELETE for that host only (session revocation).
- **Client**: `src/lib/importers/enablebanking/api.ts` — `EnableBankingClient` with injectable fetch/base URL/token source: `getApplication` (credential check), `listAspsps`, `startAuthorization`, `authorizeSession`, `getSession`, `deleteSession`, `getBalances`, `getTransactions` (with `date_from`/`date_to`/`continuation_key`), `fetchAllTransactions` (paged, capped). Errors `{error, detail}` map to `EbError(status, code)`.
- **Importer registration**: `enableBankingImporter` (`id: 'enablebanking'`, `source: 'api'`, `viewRoute: '/importers/enable-banking'`) in `src/lib/importers/index.ts`; the Importers page shows **View data** and the form editor (`EnableBankingConfigForm.svelte`: credentials, redirect URL, bank picker with consent validity capped by the ASPSP's `maximum_consent_validity`, session list with status/remove). **Reset** clears credentials + sessions. Synced config (`importer.enablebanking`) holds only `accounts` (selected uid), `daysBack` (default 90) and `psuType`.
- **Operations page**: `src/routes/importers/enable-banking/+page.svelte` — connected banks with live status, accounts table with balances (prefers `closingBooked`), and a transaction list for the selected account: booking date, creditor/debtor payee, remittance info, signed amount (DBIT negative), status badge, expandable raw JSON, date-range inputs, search, continuation-key "Load more".

## Sandbox testing

- Sandbox app registered in the Enable Banking Control Panel; redirect URLs whitelisted: `https://cashier.alensiljak.cc/importers/enable-banking/callback` and `http://localhost:5173/importers/enable-banking/callback`.
- Test bank: **Mock ASPSP** (all countries, no credentials); transactions arrive in batches of 10 via `continuation_key`.
- Dev server `http://localhost:5173` serves the same `/api/proxy` handler as the deployed Worker (vite middleware in `vite.config.ts`), so no proxy config is needed locally.

## Production notes (learned from the Control Panel)

- Sandbox and production are **separate applications** (own ID + key each, not transferable). The environment is decided by the app ID pasted into Cashier — sandbox app for testing, production app for real accounts.
- A production app starts **restricted**: the Control Panel's "Linked accounts" list is the allowlist of accounts the app may access ("Only linked accounts can be accessed"). Do not unlink accounts you want Cashier to read. The API does not expose this list and has no list-sessions call — sessions must be created through Cashier's Connect flow (`POST /auth` → redirect → `POST /sessions`); in restricted mode the session then returns only the linked accounts.
- Accounts linked through Enable Banking's own web UI belong to Enable Banking's web application; a session is only readable with the JWT of the app that initiated it (the FAQ: the token "identifies the application … all sessions initiated by the application").

## Tests

- `tests/unit/enableBankingJwt.test.ts` — real keypair: RS256 sign/verify, claims (kid/iss/aud/iat/exp), TTL clamp, PKCS#8 + PKCS#1 PEM handling (PKCS#1→PKCS#8 rewrap verified byte-for-byte), PEM errors.
- `tests/unit/enableBankingAuth.test.ts` — credential validation, device-only storage, cached token source.
- `tests/unit/enableBankingApi.test.ts` — URL/query/body building, bearer header, `/auth` + `/sessions` bodies, DELETE, continuation-key paging (incl. page cap), `EbError` mapping.
- `tests/unit/enableBankingSessions.test.ts` — session add/replace/remove/clear, pending-auth round trip and corrupt-record handling.
- `tests/unit/proxy.test.ts` — `api.enablebanking.com`: GET/POST/DELETE allowlisted, bearer forwarded to that host only, POST body + content type forwarded, DELETE still 405 elsewhere.
