// @vitest-environment node
/*
    Tests for the pasted-token authentication (src/lib/importers/scalable/token.ts
    and auth.ts): parsing the JSON printed by scripts/scalable_token.py, storing
    it device-only, and the refresh_token grant that keeps the access token
    alive — all with an injected/stubbed transport, no network.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ settings: new Map<string, unknown>() }));

vi.mock('#lib/settings', () => ({
	deviceSettings: {
		get: vi.fn(async (key: string) => store.settings.get(key) ?? null),
		set: vi.fn(async (key: string, value: unknown) => void store.settings.set(key, value)),
		delete: vi.fn(async (key: string) => void store.settings.delete(key))
	},
	DeviceSettingKeys: { scalableTokens: 'importer.scalable.tokens' }
}));

import {
	refreshTokens,
	SC_RESOURCE,
	SC_TOKEN_URL,
	TokenError
} from '#lib/importers/scalable/token';
import {
	clearAuth,
	loadAuth,
	parsePastedTokens,
	savePastedTokens,
	ScalableAuth
} from '#lib/importers/scalable/auth';

beforeEach(() => {
	store.settings.clear();
	vi.unstubAllGlobals();
});

/** The app calls upstreams through the proxy, so the target URL arrives encoded. */
function proxyUrlIncludes(target: string): (url: string) => boolean {
	return (url) => decodeURIComponent(String(url)).includes(target);
}

function fetchReturning(response: Response) {
	return vi.fn(async (..._args: unknown[]) => response);
}

/** What scripts/scalable_token.py prints at the end. */
const SCRIPT_JSON = JSON.stringify({
	client_id: 'cid-1',
	access_token: 'AT',
	refresh_token: 'RT',
	expires_in: 3600,
	token_type: 'Bearer',
	scope: 'openid profile offline_access'
});

describe('parsePastedTokens (the script output)', () => {
	it('parses the JSON the script prints and computes the expiry', () => {
		const before = Date.now();
		const auth = parsePastedTokens(SCRIPT_JSON);
		expect(auth.clientId).toBe('cid-1');
		expect(auth.accessToken).toBe('AT');
		expect(auth.refreshToken).toBe('RT');
		expect(auth.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
		expect(auth.expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
	});

	it('accepts expires_at (epoch seconds) instead of expires_in', () => {
		const at = Math.floor(Date.now() / 1000) + 600;
		const auth = parsePastedTokens(
			JSON.stringify({ client_id: 'c', access_token: 'a', expires_at: at })
		);
		expect(auth.expiresAt).toBe(at * 1000);
		expect(auth.refreshToken).toBeUndefined();
	});

	it('defaults expires_in to one hour', () => {
		const before = Date.now();
		const auth = parsePastedTokens(JSON.stringify({ client_id: 'c', access_token: 'a' }));
		expect(auth.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
	});

	it('rejects non-JSON input', () => {
		expect(() => parsePastedTokens('not json')).toThrow(TokenError);
		expect(() => parsePastedTokens('not json')).toThrow(/not valid JSON/);
	});

	it('rejects JSON without access_token or client_id', () => {
		expect(() => parsePastedTokens(JSON.stringify({ client_id: 'c' }))).toThrow(/access_token/);
		expect(() => parsePastedTokens(JSON.stringify({ access_token: 'a' }))).toThrow(/client_id/);
	});
});

describe('storage (device-only settings)', () => {
	it('savePastedTokens stores the parsed tokens and loadAuth reads them back', async () => {
		await savePastedTokens(SCRIPT_JSON);
		const auth = await loadAuth();
		expect(auth?.accessToken).toBe('AT');
		expect(auth?.clientId).toBe('cid-1');
		expect(store.settings.get('importer.scalable.tokens')).toBeTruthy();
	});

	it('clearAuth removes the stored tokens', async () => {
		await savePastedTokens(SCRIPT_JSON);
		await clearAuth();
		expect(await loadAuth()).toBeNull();
	});
});

describe('refreshTokens (token endpoint, refresh_token grant)', () => {
	it('POSTs the form-encoded grant with client_id and the resource indicator', async () => {
		const fetchImpl = fetchReturning(
			new Response(JSON.stringify({ access_token: 'at2', expires_in: 3600 }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const tokens = await refreshTokens('cid-1', 'rt-1', fetchImpl as never);
		expect(tokens.access_token).toBe('at2');
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			{ method: string; body: string; headers: Record<string, string> }
		];
		expect(url).toBe(SC_TOKEN_URL);
		expect(init.method).toBe('POST');
		expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
		const params = new URLSearchParams(init.body);
		expect(params.get('grant_type')).toBe('refresh_token');
		expect(params.get('refresh_token')).toBe('rt-1');
		expect(params.get('client_id')).toBe('cid-1');
		expect(params.get('resource')).toBe(SC_RESOURCE);
	});

	it('surfaces the provider error description', async () => {
		const fetchImpl = fetchReturning(
			new Response(
				JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token revoked' }),
				{ status: 400 }
			)
		);
		await expect(refreshTokens('cid', 'rt', fetchImpl as never)).rejects.toThrow(
			/refresh token revoked/
		);
	});
});

describe('ScalableAuth (McpTokenSource)', () => {
	it('throws a helpful error when nothing was pasted yet', async () => {
		await expect(new ScalableAuth().getToken()).rejects.toThrow(/scalable_token\.py/);
	});

	it('returns the stored token while it is valid', async () => {
		store.settings.set('importer.scalable.tokens', {
			clientId: 'cid',
			accessToken: 'valid',
			refreshToken: 'rt',
			expiresAt: Date.now() + 3_600_000
		});
		expect(await new ScalableAuth().getToken()).toBe('valid');
	});

	it('refreshes an expired token through the proxy and persists the new one', async () => {
		store.settings.set('importer.scalable.tokens', {
			clientId: 'cid',
			accessToken: 'old',
			refreshToken: 'rt',
			expiresAt: Date.now() - 1000
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				expect(proxyUrlIncludes(SC_TOKEN_URL)(String(url))).toBe(true);
				expect(new URLSearchParams(String(init?.body)).get('refresh_token')).toBe('rt');
				return new Response(
					JSON.stringify({ access_token: 'new', refresh_token: 'rt2', expires_in: 3600 }),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				);
			})
		);
		expect(await new ScalableAuth().getToken()).toBe('new');
		const auth = await loadAuth();
		expect(auth?.accessToken).toBe('new');
		expect(auth?.refreshToken).toBe('rt2');
	});

	it('reports re-login needed when the refresh fails', async () => {
		store.settings.set('importer.scalable.tokens', {
			clientId: 'cid',
			accessToken: 'old',
			refreshToken: 'rt',
			expiresAt: Date.now() - 1000
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('revoked', { status: 400 }))
		);
		await expect(new ScalableAuth().getToken()).rejects.toThrow(/expired/);
	});

	it('reports re-login needed when there is no refresh token', async () => {
		store.settings.set('importer.scalable.tokens', {
			clientId: 'cid',
			accessToken: 'old',
			expiresAt: Date.now() - 1000
		});
		await expect(new ScalableAuth().getToken()).rejects.toThrow(/expired/);
	});
});
