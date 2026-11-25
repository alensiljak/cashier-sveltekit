#!/usr/bin/env python3
"""Fetch Scalable Capital MCP tokens for Cashier.

A PWA cannot run the OAuth 2.0 loopback flow itself (a hosted page has no
localhost redirect URI it can receive), so this script does it on your
computer instead:

1. registers a public OAuth client (RFC 7591 dynamic registration) with a
   http://localhost redirect URI,
2. opens Scalable's login + consent page in your browser
   ("Connect ... to Scalable MCP?"),
3. catches the authorization code on localhost and exchanges it for tokens
   (Authorization Code + PKCE S256, public client — no secret),
4. prints the tokens as JSON.

Paste that JSON into Cashier: Importers -> Scalable Capital -> Configure.
Cashier stores the tokens on that device only (never synced or exported) and
uses the refresh token to keep the access token alive.

Usage:
    uv run scripts/scalable_token.py      # or: python3 scripts/scalable_token.py

Requires Python 3.10+, no third-party packages. Enable MCP access
("Agentic Investing") for your Scalable account first: Scalable app/web ->
Profile -> Settings -> Security.
"""

import argparse
import base64
import hashlib
import json
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

SC_BASE = "https://mcp.scalable.capital"
# RFC 8707 resource indicator for the MCP server (required on authorize/token).
SC_RESOURCE = f"{SC_BASE}/mcp"
SCOPE = "openid profile offline_access"
DEFAULT_PORT = 8484


def server_metadata() -> dict:
    """Authorization-server metadata, with the known defaults as fallback."""
    try:
        with urllib.request.urlopen(
            f"{SC_BASE}/.well-known/oauth-authorization-server", timeout=10
        ) as response:
            return json.load(response)
    except Exception as exc:  # offline or metadata moved: fall back to defaults
        print(f"(could not read authorization-server metadata: {exc}; using defaults)", file=sys.stderr)
        return {}


def post_json(url: str, payload: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def post_form(url: str, params: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=urllib.parse.urlencode(params).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise SystemExit(f"Token request failed (HTTP {exc.code}): {detail}")


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class CallbackHandler(BaseHTTPRequestHandler):
    """Serves exactly one request: the OAuth redirect back to localhost."""

    code: str | None = None
    state: str | None = None
    error: str | None = None

    def do_GET(self) -> None:
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        CallbackHandler.code = query.get("code", [None])[0]
        CallbackHandler.state = query.get("state", [None])[0]
        CallbackHandler.error = query.get("error", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        if CallbackHandler.error:
            body = f"<h3>Scalable did not grant access: {CallbackHandler.error}</h3>".encode()
        else:
            body = b"<h3>Login received.</h3><p>Close this tab and return to the terminal.</p>"
        self.wfile.write(body)

    def log_message(self, *args) -> None:  # keep the terminal clean
        pass


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"localhost port for the OAuth redirect (default: {DEFAULT_PORT})",
    )
    args = parser.parse_args()

    redirect_uri = f"http://localhost:{args.port}/callback"
    metadata = server_metadata()
    authorize_url = metadata.get("authorization_endpoint", f"{SC_BASE}/authorize")
    token_url = metadata.get("token_endpoint", f"{SC_BASE}/token")
    register_url = metadata.get("registration_endpoint", f"{SC_BASE}/register")

    # 1. Dynamic client registration (public client, no secret).
    registration = post_json(
        register_url,
        {
            "client_name": "Cashier (scalable_token.py)",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "scope": SCOPE,
        },
    )
    client_id = registration.get("client_id")
    if not client_id:
        raise SystemExit(f"Registration returned no client_id: {registration}")

    # 2. PKCE S256 + state, then open the login/consent page.
    verifier = b64url(secrets.token_bytes(32))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    state = secrets.token_urlsafe(16)
    auth_url = authorize_url + "?" + urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": SCOPE,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "resource": SC_RESOURCE,
        }
    )

    server = HTTPServer(("127.0.0.1", args.port), CallbackHandler)
    print(f"Opening {authorize_url} in your browser for login + consent ...")
    if not webbrowser.open(auth_url):
        print(f"Open this URL manually:\n\n  {auth_url}\n")
    print("Waiting for the redirect on localhost ... (Ctrl+C to abort)")
    server.handle_request()  # a single request carries the code
    server.server_close()

    if CallbackHandler.error:
        raise SystemExit(f"Scalable did not grant access: {CallbackHandler.error}")
    if not CallbackHandler.code or CallbackHandler.state != state:
        raise SystemExit("The callback did not match this run (state mismatch) — try again.")

    # 3. Exchange the code for tokens.
    tokens = post_form(
        token_url,
        {
            "grant_type": "authorization_code",
            "code": CallbackHandler.code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "code_verifier": verifier,
            "resource": SC_RESOURCE,
        },
    )
    if not tokens.get("access_token"):
        raise SystemExit(f"Token endpoint returned no access_token: {tokens}")

    output = {
        "client_id": client_id,
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "expires_in": tokens.get("expires_in"),
        "token_type": tokens.get("token_type", "Bearer"),
        "scope": tokens.get("scope"),
    }
    print("\nDone. Paste this JSON into Cashier")
    print("(Importers -> Scalable Capital -> Configure -> 'Tokens' field):\n")
    print(json.dumps(output, indent=2))
    print("\nCashier stores it on this device only and refreshes the access token")
    print("automatically via the refresh token. When the refresh token expires,")
    print("run this script again and paste the new JSON.")


if __name__ == "__main__":
    main()
