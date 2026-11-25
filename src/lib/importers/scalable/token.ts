/**
 * OAuth 2.0 token endpoint of the Scalable Capital MCP authorization server.
 *
 * The PWA cannot run the login itself (a hosted page has no localhost redirect
 * to receive the authorization code), so the user runs
 * `scripts/scalable_token.py` on their computer, which performs the
 * Authorization Code + PKCE flow against a loopback redirect and prints the
 * tokens as JSON. This module only consumes those tokens: the refresh_token
 * grant keeps the access token alive. POSTs go through the app's CORS proxy
 * (proxyFetch) — the token endpoint needs no client secret (public client,
 * auth method "none"), just the client_id the script registered.
 */
import { proxyFetch } from '#lib/services/prices/proxyFetch';

export const SC_TOKEN_URL = 'https://mcp.scalable.capital/token';
/** RFC 8707 resource indicator for the MCP server (required by the MCP spec). */
export const SC_RESOURCE = 'https://mcp.scalable.capital/mcp';

export class TokenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TokenError';
	}
}

export interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type?: string;
	scope?: string;
}

type FetchImpl = typeof proxyFetch;

/** Exchange a refresh token for a new access token (refresh_token grant). */
export async function refreshTokens(
	clientId: string,
	refreshToken: string,
	fetchImpl: FetchImpl = proxyFetch
): Promise<TokenResponse> {
	const response = await fetchImpl(SC_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: clientId,
			resource: SC_RESOURCE
		}).toString()
	});
	const data = (await response.json().catch(() => ({}))) as TokenResponse & {
		error?: string;
		error_description?: string;
	};
	if (!response.ok) {
		throw new TokenError(
			`Token refresh failed (HTTP ${response.status}): ${data.error_description ?? data.error ?? response.statusText}`
		);
	}
	if (typeof data.access_token !== 'string' || !data.access_token) {
		throw new TokenError('Token endpoint returned no access_token');
	}
	return data;
}
