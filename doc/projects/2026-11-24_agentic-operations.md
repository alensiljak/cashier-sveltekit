# Agentic Operations

Integrate an agent so that it can run Cashier on user's behalf.
Expose functionality. Research what standards are there for this.

Examples:

- create new transaction
- show scheduled transactions
- open calendar
- open reports

## Authentication for the Scalable Capital MCP endpoint

The first MCP-backed source (Scalable Capital, see `2026-11-25_scalable-capital-importer.md`)
cannot authenticate from inside the PWA: OAuth 2.0 Authorization Code + PKCE needs a
`http://localhost` redirect, which a hosted page cannot receive. Workaround: the user runs
`scripts/scalable_token.py` on their computer (the app offers it via a **Copy script** button),
which does the loopback login and prints the tokens as JSON; the user pastes that JSON into
Cashier, where it is stored device-only and refreshed via the `refresh_token` grant.
If a future standard (e.g. a PWA-compatible browser flow or device-code grant) fits better,
re-evaluate here.
