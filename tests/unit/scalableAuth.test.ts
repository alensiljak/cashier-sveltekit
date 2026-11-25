// @vitest-environment node
/*
    Tests for the Scalable Capital OAuth flow (src/lib/importers/scalable/oauth.ts
    and auth.ts): dynamic client registration, the authorize URL, PKCE, the code
    exchange and refresh — all with an injected/stubbed transport, no network.
*/
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
	settings: new Map<string, unknown>(),
	local: new Map<string, string>()
}));

vi.mock('#lib/settings', () => ({
	deviceSettings: {
		get: vi.fn(async (key: string) => store.settings.get(key) ?? null),
		set: vi.fn(async (key: string, value: unknown) => void store.settings.set(key, value)),
		delete: vi.fn(async (key: string) => void store.settings.delete(key))
	},
	DeviceSettingKeys: { scalableOAuth: 'importer.scalable.oauth' }
}));

import {
	authorizeUrl,
	callbackUrl,
	createPkce,
	exchangeCode,
	OAuthError,
	refreshTokens,
	registerClient,
	SC_AUTHORIZE_URL,
	SC_REGISTER_URL,
	SC_RESOURCE,
	SC_TOKEN_URL
} from '#lib/importers/scalable/oauth';
import {
	clearAuth,
	completeAuthorization,
	loadAuth,
	ScalableAuth,
	startAuthorization
} from '#lib/importers/scalable/auth';

function b64urlSha256(s: string): string {
	return createHash('sha256').update(s).digest('base64url');
}

beforeEach(() => {
	store.settings.clear();
	store.local.clear();
	vi.unstubAllGlobals();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.local.get(k) ?? null,
		setItem: (k: string, v: string) => void store.local.set(k, v),
		removeItem: (k: string) => void store.local.delete(k)
	});
});

/** The app calls upstreams through the proxy, so the target URL arrives encoded. */
function proxyUrlIncludes(target: string): (url: string) => boolean {
	return (url) => decodeURIComponent(String(url)).includes(target);
}

function fetchReturning(response: Response) {
	return vi.fn(async (..._args: unknown[]) => response);
}

describe('registerClient', () => {
	it('POSTs the dynamic registration and returns the client_id', async () => {
		const fetchImpl = fetchReturning(
			new Response(JSON.stringify({ client_id: 'cid-1', client_id_issued_at: 1 }), { status: 201 })
		);
		const clientId = await registerClient(
			'http://localhost:5173/importers/scalable/callback',
			fetchImpl as never
		);
		expect(clientId).toBe('cid-1');
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			{ method: string; body: string; headers: Record<string, string> }
		];
		expect(url).toBe(SC_REGISTER_URL);
		expect(init.method).toBe('POST');
		const body = JSON.parse(init.body);
		expect(body.token_endpoint_auth_method).toBe('none');
		expect(body.redirect_uris).toEqual(['http://localhost:5173/importers/scalable/callback']);
	});

	it('throws an OAuthError on failure', async () => {
		const fetchImpl = fetchReturning(new Response('nope', { status: 400 }));
		await expect(
			registerClient('http://localhost:5173/importers/scalable/callback', fetchImpl as never)
		).rejects.toThrow(OAuthError);
	});
});

describe('PKCE and authorize URL', () => {
	it('creates an S256 pair that matches', async () => {
		const { verifier, challenge } = await createPkce();
		expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(challenge).toBe(b64urlSha256(verifier));
	});

	it('builds the authorize URL with all required parameters', () => {
		const url = new URL(
			authorizeUrl({
				clientId: 'cid',
				redirectUri: 'https://app.example/importers/scalable/callback',
				state: 'st',
				challenge: 'ch'
			})
		);
		expect(url.origin + url.pathname).toBe(SC_AUTHORIZE_URL);
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('client_id')).toBe('cid');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('resource')).toBe(SC_RESOURCE);
		expect(url.searchParams.get('scope')).toContain('openid');
	});

	it('maps the origin to the callback URL', () => {
		expect(callbackUrl('https://cashier.example')).toBe(
			'https://cashier.example/importers/scalable/callback'
		);
	});
});

describe('token endpoint', () => {
	it('exchanges the code as form-urlencoded with the resource indicator', async () => {
		const fetchImpl = fetchReturning(
			new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const tokens = await exchangeCode(
			'cid',
			'https://app/cb',
			'code1',
			'verifier1',
			fetchImpl as never
		);
		expect(tokens.access_token).toBe('at');
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			{ body: string; headers: Record<string, string> }
		];
		expect(url).toBe(SC_TOKEN_URL);
		expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
		const params = new URLSearchParams(init.body);
		expect(params.get('grant_type')).toBe('authorization_code');
		expect(params.get('code')).toBe('code1');
		expect(params.get('code_verifier')).toBe('verifier1');
		expect(params.get('client_id')).toBe('cid');
		expect(params.get('resource')).toBe(SC_RESOURCE);
	});

	it('refreshes with the refresh_token grant', async () => {
		const fetchImpl = fetchReturning(
			new Response(JSON.stringify({ access_token: 'at2', expires_in: 3600 }), { status: 200 })
		);
		const tokens = await refreshTokens('cid', 'rt', fetchImpl as never);
		expect(tokens.access_token).toBe('at2');
		const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
		expect(new URLSearchParams(init.body).get('grant_type')).toBe('refresh_token');
	});

	it('surfaces the provider error description', async () => {
		const fetchImpl = fetchReturning(
			new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'code expired' }), {
				status: 400
			})
		);
		await expect(
			exchangeCode('cid', 'https://app/cb', 'x', 'v', fetchImpl as never)
		).rejects.toThrow(/code expired/);
	});
});

describe('authorization flow (auth.ts)', () => {
	it('startAuthorization registers once, stashes PKCE, and returns the login URL', async () => {
		const registerFetch = fetchReturning(
			new Response(JSON.stringify({ client_id: 'cid-9' }), { status: 201 })
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				if (proxyUrlIncludes(SC_REGISTER_URL)(String(url))) return registerFetch(url, init);
				throw new Error('unexpected ' + url);
			})
		);
		const url = await startAuthorization('http://localhost:5173');
		expect(url.startsWith(SC_AUTHORIZE_URL)).toBe(true);
		const pending = JSON.parse(store.local.get('cashier.scalable.oauth.pending')!);
		expect(pending.clientId).toBe('cid-9');
		expect(new URL(url).searchParams.get('state')).toBe(pending.state);
		expect(new URL(url).searchParams.get('code_challenge')).toBe(b64urlSha256(pending.verifier));
	});

	it('completeAuthorization rejects a state mismatch', async () => {
		store.local.set(
			'cashier.scalable.oauth.pending',
			JSON.stringify({ state: 'a', verifier: 'v', clientId: 'c', redirectUri: 'https://app/cb' })
		);
		await expect(
			completeAuthorization(new URLSearchParams({ code: 'x', state: 'b' }))
		).rejects.toThrow(/state mismatch/);
	});

	it('completeAuthorization rejects a provider error', async () => {
		await expect(
			completeAuthorization(new URLSearchParams({ error: 'access_denied' }))
		).rejects.toThrow(/access_denied/);
	});

	it('completeAuthorization exchanges the code and stores the tokens device-only', async () => {
		store.local.set(
			'cashier.scalable.oauth.pending',
			JSON.stringify({
				state: 's1',
				verifier: 'v1',
				clientId: 'cid',
				redirectUri: 'https://app/cb'
			})
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				expect(proxyUrlIncludes(SC_TOKEN_URL)(String(url))).toBe(true);
				return new Response(
					JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				);
			})
		);
		await completeAuthorization(new URLSearchParams({ code: 'c1', state: 's1' }));
		const auth = await loadAuth();
		expect(auth?.accessToken).toBe('AT');
		expect(auth?.refreshToken).toBe('RT');
		expect(auth?.clientId).toBe('cid');
		expect(store.local.has('cashier.scalable.oauth.pending')).toBe(false);
	});

	it('ScalableAuth returns a fresh token and refreshes an expired one', async () => {
		store.settings.set('importer.scalable.oauth', {
			clientId: 'cid',
			redirectUri: 'https://app/cb',
			accessToken: 'old',
			refreshToken: 'rt',
			expiresAt: Date.now() - 1000
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					})
			)
		);
		const auth = new ScalableAuth();
		expect(await auth.getToken()).toBe('new');
		expect((await loadAuth())?.accessToken).toBe('new');
	});

	it('ScalableAuth returns the stored token while it is valid', async () => {
		store.settings.set('importer.scalable.oauth', {
			clientId: 'cid',
			redirectUri: 'https://app/cb',
			accessToken: 'valid',
			expiresAt: Date.now() + 3_600_000
		});
		expect(await new ScalableAuth().getToken()).toBe('valid');
	});

	it('clearAuth removes the stored tokens and pending flow', async () => {
		store.settings.set('importer.scalable.oauth', { clientId: 'c', accessToken: 'a' });
		store.local.set('cashier.scalable.oauth.pending', '{}');
		await clearAuth();
		expect(await loadAuth()).toBeNull();
		expect(store.local.has('cashier.scalable.oauth.pending')).toBe(false);
	});
});
