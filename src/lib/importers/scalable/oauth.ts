/**
 * OAuth 2.0 (Authorization Code + PKCE, RFC 7591 dynamic client registration)
 * against the Scalable Capital MCP authorization server. Public metadata:
 *
 * - https://mcp.scalable.capital/.well-known/oauth-authorization-server
 * - https://mcp.scalable.capital/.well-known/oauth-protected-resource/mcp
 *
 * The browser opens the `authorize` URL (login + consent); the app receives
 * the code on its callback route and exchanges it at the `token` endpoint.
 * All POSTs go through the app's CORS proxy (proxyFetch) — the register and
 * token endpoints need no bearer token (public client, auth method "none").
 */
import { proxyFetch } from '#lib/services/prices/proxyFetch';

export const SC_AUTHORIZE_URL = 'https://mcp.scalable.capital/authorize';
export const SC_TOKEN_URL = 'https://mcp.scalable.capital/token';
export const SC_REGISTER_URL = 'https://mcp.scalable.capital/register';
/** RFC 8707 resource indicator for the MCP server (required by the MCP spec). */
export const SC_RESOURCE = 'https://mcp.scalable.capital/mcp';
export const SC_SCOPE = 'openid profile offline_access';
/** Route that receives the authorization code redirect. */
export const CALLBACK_PATH = '/importers/scalable/callback';

export class OAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OAuthError';
	}
}

export function callbackUrl(origin: string): string {
	return `${origin}${CALLBACK_PATH}`;
}

type FetchImpl = typeof proxyFetch;

/** Register this app as a public OAuth client; returns the client_id. */
export async function registerClient(
	redirectUri: string,
	fetchImpl: FetchImpl = proxyFetch
): Promise<string> {
	const response = await fetchImpl(SC_REGISTER_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_name: 'Cashier',
			redirect_uris: [redirectUri],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			scope: SC_SCOPE
		})
	});
	if (!response.ok) {
		const detail = (await response.text().catch(() => '')).slice(0, 300);
		throw new OAuthError(`Client registration failed (HTTP ${response.status}): ${detail}`);
	}
	const data = (await response.json()) as { client_id?: unknown };
	if (typeof data.client_id !== 'string' || !data.client_id) {
		throw new OAuthError('Registration returned no client_id');
	}
	return data.client_id;
}

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** PKCE S256 pair (WebCrypto, so it also works on non-secure dev origins where available). */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
	const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function createState(): string {
	return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export function authorizeUrl(params: {
	clientId: string;
	redirectUri: string;
	state: string;
	challenge: string;
}): string {
	const query = new URLSearchParams({
		response_type: 'code',
		client_id: params.clientId,
		redirect_uri: params.redirectUri,
		scope: SC_SCOPE,
		state: params.state,
		code_challenge: params.challenge,
		code_challenge_method: 'S256',
		resource: SC_RESOURCE
	});
	return `${SC_AUTHORIZE_URL}?${query.toString()}`;
}

export interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type?: string;
	scope?: string;
}

async function tokenRequest(
	params: Record<string, string>,
	fetchImpl: FetchImpl
): Promise<TokenResponse> {
	const response = await fetchImpl(SC_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ ...params, resource: SC_RESOURCE }).toString()
	});
	const data = (await response.json().catch(() => ({}))) as TokenResponse & {
		error?: string;
		error_description?: string;
	};
	if (!response.ok) {
		throw new OAuthError(
			`Token request failed (HTTP ${response.status}): ${data.error_description ?? data.error ?? response.statusText}`
		);
	}
	if (typeof data.access_token !== 'string' || !data.access_token) {
		throw new OAuthError('Token endpoint returned no access_token');
	}
	return data;
}

export function exchangeCode(
	clientId: string,
	redirectUri: string,
	code: string,
	verifier: string,
	fetchImpl: FetchImpl = proxyFetch
): Promise<TokenResponse> {
	return tokenRequest(
		{
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: clientId,
			code_verifier: verifier
		},
		fetchImpl
	);
}

export function refreshTokens(
	clientId: string,
	refreshToken: string,
	fetchImpl: FetchImpl = proxyFetch
): Promise<TokenResponse> {
	return tokenRequest(
		{ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
		fetchImpl
	);
}
