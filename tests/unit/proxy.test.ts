// @vitest-environment node
/*
    Tests for the generic CORS proxy handler (worker/proxy.ts). The handler is
    exercised with an injected fetch, so no network is touched; the Vite
    middleware and the Worker entry both call this same function.
*/
import { describe, expect, it, vi } from 'vitest';
import {
	ALLOWED_HOSTS,
	DELETE_HOSTS,
	handleProxyRequest,
	MCP_SESSION_HEADER,
	PROXY_KEY_HEADER,
	ProxyRequestError,
	resolveProxyTarget,
	UPSTREAM_BEARER_HEADER,
	UPSTREAM_SESSION_HEADER,
	type FetchLike
} from '../../worker/proxy';

const ALLOWED =
	'https://www.vanguard.com.au/personal/api/products/personal/fund/8105/prices?limit=1';

function proxyRequest(target: string, init: RequestInit = {}): Request {
	return new Request(`https://cashier.test/api/proxy?url=${encodeURIComponent(target)}`, init);
}

function stubFetch(response: Response | (() => Promise<Response>)): FetchLike {
	return vi.fn(async () => (typeof response === 'function' ? response() : response)) as FetchLike;
}

describe('resolveProxyTarget', () => {
	it('accepts an allowlisted https URL and keeps its query', () => {
		const url = resolveProxyTarget(ALLOWED);
		expect(url.hostname).toBe('www.vanguard.com.au');
		expect(url.search).toBe('?limit=1');
	});

	it('rejects missing, malformed, non-https and credential-bearing URLs', () => {
		expect(() => resolveProxyTarget(null)).toThrow(ProxyRequestError);
		expect(() => resolveProxyTarget('not a url')).toThrow(/Invalid/);
		expect(() => resolveProxyTarget('http://www.vanguard.com.au/x')).toThrow(/https/);
		expect(() => resolveProxyTarget('https://user:pass@www.vanguard.com.au/x')).toThrow(
			/Credentials/
		);
	});

	it('rejects hosts outside the allowlist', () => {
		expect(() => resolveProxyTarget('https://example.com/')).toThrow(/Host not allowed/);
		expect(Object.hasOwn(ALLOWED_HOSTS, 'www.vanguard.com.au')).toBe(true);
	});
});

describe('proxy key', () => {
	it('rejects a missing key when one is required', async () => {
		const response = await handleProxyRequest(proxyRequest(ALLOWED), { requiredKey: 'secret' });
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Invalid proxy key' });
	});

	it('rejects a wrong key', async () => {
		const response = await handleProxyRequest(
			proxyRequest(ALLOWED, { headers: { [PROXY_KEY_HEADER]: 'wrong' } }),
			{ requiredKey: 'secret' }
		);
		expect(response.status).toBe(401);
	});

	it('accepts the matching key', async () => {
		const response = await handleProxyRequest(
			proxyRequest(ALLOWED, { headers: { [PROXY_KEY_HEADER]: 'secret' } }),
			{ requiredKey: 'secret', fetchImpl: stubFetch(new Response('{}')) }
		);
		expect(response.status).toBe(200);
	});

	it('fails closed when the Worker has no key configured', async () => {
		const response = await handleProxyRequest(proxyRequest(ALLOWED), { requireKey: true });
		expect(response.status).toBe(503);
	});

	it('stays open in dev when no key policy is supplied', async () => {
		const response = await handleProxyRequest(proxyRequest(ALLOWED), {
			fetchImpl: stubFetch(new Response('{}'))
		});
		expect(response.status).toBe(200);
	});
});

describe('handleProxyRequest', () => {
	it('rejects POST for hosts that are GET-only', async () => {
		const response = await handleProxyRequest(proxyRequest(ALLOWED, { method: 'POST' }));
		expect(response.status).toBe(405);
		expect(await response.text()).toContain('POST is not allowed');
	});

	it('rejects DELETE for hosts that are not in DELETE_HOSTS', async () => {
		const response = await handleProxyRequest(proxyRequest(ALLOWED, { method: 'DELETE' }));
		expect(response.status).toBe(405);
		expect(await response.text()).toContain('DELETE is not allowed');
	});

	it('forwards only the proxy headers, never Origin, Referer or Cookie', async () => {
		let seen: { input: RequestInfo | URL; init?: RequestInit } | undefined;
		const fetchImpl: FetchLike = async (input, init) => {
			seen = { input, init };
			return new Response('{"ok":true}', {
				headers: { 'content-type': 'application/json; charset=utf-8' }
			});
		};

		const response = await handleProxyRequest(
			proxyRequest(ALLOWED, {
				headers: {
					Origin: 'https://cashier.test',
					Referer: 'https://cashier.test/prices/download',
					Cookie: 'session=secret'
				}
			}),
			{ fetchImpl }
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(String(seen?.input)).toBe(ALLOWED);
		expect(seen?.init?.headers).toEqual({
			Accept: 'application/json, text/plain, */*',
			'User-Agent': 'Cashier price proxy (+https://cashier.alensiljak.cc)'
		});
		expect(seen?.init?.redirect).toBe('manual');
	});

	it('passes an upstream error status and body through', async () => {
		const response = await handleProxyRequest(proxyRequest(ALLOWED), {
			fetchImpl: stubFetch(new Response('upstream boom', { status: 500 }))
		});
		expect(response.status).toBe(500);
		expect(await response.text()).toBe('upstream boom');
	});

	it('refuses to follow redirects', async () => {
		const response = await handleProxyRequest(proxyRequest(ALLOWED), {
			fetchImpl: stubFetch(
				new Response(null, { status: 302, headers: { location: 'https://example.com/' } })
			)
		});
		expect(response.status).toBe(502);
		expect(await response.text()).toContain('redirect');
	});

	it('caps oversized upstream responses', async () => {
		const response = await handleProxyRequest(proxyRequest(ALLOWED), {
			fetchImpl: stubFetch(new Response(new Uint8Array(5 * 1024 * 1024 + 1)))
		});
		expect(response.status).toBe(502);
		expect(await response.text()).toContain('exceeds');
	});

	it('falls back to octet-stream for non-text content types', async () => {
		const response = await handleProxyRequest(proxyRequest(ALLOWED), {
			fetchImpl: stubFetch(
				new Response('binary', { headers: { 'content-type': 'application/octet-stream' } })
			)
		});
		expect(response.headers.get('content-type')).toBe('application/octet-stream');
	});

	it('returns a null body for a 204 response', async () => {
		const response = await handleProxyRequest(proxyRequest(ALLOWED), {
			fetchImpl: stubFetch(new Response(null, { status: 204 }))
		});
		expect(response.status).toBe(204);
		expect(await response.text()).toBe('');
	});

	it('maps an abort to a timeout response', async () => {
		const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
		const response = await handleProxyRequest(proxyRequest(ALLOWED), {
			fetchImpl: stubFetch(async () => {
				throw abort;
			})
		});
		expect(response.status).toBe(504);
		expect(await response.text()).toContain('timed out');
	});

	it('maps a network failure to a bad-gateway response', async () => {
		const response = await handleProxyRequest(proxyRequest(ALLOWED), {
			fetchImpl: stubFetch(async () => {
				throw new TypeError('fetch failed');
			})
		});
		expect(response.status).toBe(502);
		expect(await response.text()).toContain('Upstream request failed');
	});

	it('rejects a disallowed target before fetching', async () => {
		const fetchImpl = vi.fn();
		const response = await handleProxyRequest(proxyRequest('https://example.com/'), {
			fetchImpl: fetchImpl as unknown as FetchLike
		});
		expect(response.status).toBe(403);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

describe('POST uploads (Mistral Voxtral)', () => {
	const MISTRAL = 'https://api.mistral.ai/v1/audio/transcriptions';

	function uploadRequest(headers: Record<string, string> = {}): Request {
		const form = new FormData();
		form.append('file', new Blob(['audio'], { type: 'audio/webm' }), 'speech.webm');
		form.append('model', 'voxtral-mini-transcribe-3');
		return proxyRequest(MISTRAL, { method: 'POST', headers, body: form });
	}

	it('forwards the body and content type, and the bearer token as Authorization', async () => {
		let seen: { input: RequestInfo | URL; init?: RequestInit } | undefined;
		const fetchImpl: FetchLike = async (input, init) => {
			seen = { input, init };
			return new Response(JSON.stringify({ text: 'hello' }), {
				headers: { 'content-type': 'application/json' }
			});
		};

		const response = await handleProxyRequest(
			uploadRequest({ [UPSTREAM_BEARER_HEADER]: 'key-123' }),
			{ fetchImpl }
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ text: 'hello' });
		expect(String(seen?.input)).toBe(MISTRAL);
		expect(seen?.init?.method).toBe('POST');
		const headers = seen?.init?.headers as Record<string, string>;
		expect(headers['Authorization']).toBe('Bearer key-123');
		expect(headers['Content-Type']).toContain('multipart/form-data');
		expect(headers['X-Upstream-Authorization']).toBeUndefined();
		expect(seen?.init?.body).toBeInstanceOf(ArrayBuffer);
	});

	it('drops the bearer token for hosts that do not take one', async () => {
		let seen: RequestInit | undefined;
		const fetchImpl: FetchLike = async (_input, init) => {
			seen = init;
			return new Response('{}', { headers: { 'content-type': 'application/json' } });
		};
		const authorization = () =>
			(seen?.headers as Record<string, string> | undefined)?.['Authorization'];

		await handleProxyRequest(uploadRequest({ [UPSTREAM_BEARER_HEADER]: 'key-123' }), {
			fetchImpl
		});
		expect(authorization()).toBe('Bearer key-123');

		// A GET to a price host never carries the token.
		await handleProxyRequest(
			proxyRequest(ALLOWED, { headers: { [UPSTREAM_BEARER_HEADER]: 'key-123' } }),
			{ fetchImpl }
		);
		expect(authorization()).toBeUndefined();
	});

	it('caps oversized uploads', async () => {
		const response = await handleProxyRequest(
			proxyRequest(MISTRAL, {
				method: 'POST',
				body: new Uint8Array(25 * 1024 * 1024 + 1)
			}),
			{ fetchImpl: stubFetch(new Response('{}')) }
		);
		expect(response.status).toBe(413);
	});
});

describe('MCP host (mcp.scalable.capital)', () => {
	const MCP = 'https://mcp.scalable.capital/mcp';

	function mcpPost(headers: Record<string, string> = {}): Request {
		return proxyRequest(MCP, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
		});
	}

	it('is allowlisted for POST with a bearer token', async () => {
		expect(Object.hasOwn(ALLOWED_HOSTS, 'mcp.scalable.capital')).toBe(true);
		let seen: RequestInit | undefined;
		const fetchImpl: FetchLike = async (_input, init) => {
			seen = init;
			return new Response('{"jsonrpc":"2.0","id":1,"result":{}}', {
				headers: { 'content-type': 'application/json', [MCP_SESSION_HEADER]: 'sess-9' }
			});
		};

		const response = await handleProxyRequest(mcpPost({ [UPSTREAM_BEARER_HEADER]: 'tok' }), {
			fetchImpl
		});

		expect(response.status).toBe(200);
		const headers = seen?.headers as Record<string, string>;
		expect(headers['Authorization']).toBe('Bearer tok');
		// MCP servers require this Accept; SSE responses stay readable through text/*.
		expect(headers['Accept']).toBe('application/json, text/event-stream');
		// The session id comes back to the client so it can continue the session.
		expect(response.headers.get(MCP_SESSION_HEADER)).toBe('sess-9');
	});

	it('forwards the client session id as Mcp-Session-Id, and only for MCP hosts', async () => {
		let seen: RequestInit | undefined;
		const fetchImpl: FetchLike = async (_input, init) => {
			seen = init;
			return new Response('{}', { headers: { 'content-type': 'application/json' } });
		};

		const sessionHeader = () =>
			(seen?.headers as Record<string, string> | undefined)?.['Mcp-Session-Id'];

		await handleProxyRequest(mcpPost({ [UPSTREAM_SESSION_HEADER]: 'sess-1' }), { fetchImpl });
		expect(sessionHeader()).toBe('sess-1');

		await handleProxyRequest(
			proxyRequest(ALLOWED, { headers: { [UPSTREAM_SESSION_HEADER]: 'sess-1' } }),
			{ fetchImpl }
		);
		expect(sessionHeader()).toBeUndefined();
	});

	it('keeps POST GET-only rules for non-MCP hosts', async () => {
		const response = await handleProxyRequest(proxyRequest(ALLOWED, { method: 'POST' }));
		expect(response.status).toBe(405);
	});
});

describe('Enable Banking host (api.enablebanking.com)', () => {
	const EB = 'https://api.enablebanking.com/accounts/acc-1/transactions';

	it('is allowlisted for GET, POST and DELETE', async () => {
		expect(Object.hasOwn(ALLOWED_HOSTS, 'api.enablebanking.com')).toBe(true);
		expect(Object.hasOwn(DELETE_HOSTS, 'api.enablebanking.com')).toBe(true);
		const fetchImpl: FetchLike = async () =>
			new Response('{}', { headers: { 'content-type': 'application/json' } });
		expect((await handleProxyRequest(proxyRequest(EB), { fetchImpl })).status).toBe(200);
		expect(
			(
				await handleProxyRequest(
					proxyRequest('https://api.enablebanking.com/auth', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: '{}'
					}),
					{ fetchImpl }
				)
			).status
		).toBe(200);
		expect(
			(
				await handleProxyRequest(
					proxyRequest('https://api.enablebanking.com/sessions/sess-1', { method: 'DELETE' }),
					{ fetchImpl }
				)
			).status
		).toBe(200);
	});

	it('forwards the client bearer as Authorization to the EB host only', async () => {
		let seen: RequestInit | undefined;
		const fetchImpl: FetchLike = async (_input, init) => {
			seen = init;
			return new Response('{}', { headers: { 'content-type': 'application/json' } });
		};

		const headers = (): Record<string, string> => (seen?.headers ?? {}) as Record<string, string>;

		await handleProxyRequest(
			proxyRequest(EB, { headers: { [UPSTREAM_BEARER_HEADER]: 'jwt-token' } }),
			{ fetchImpl }
		);
		expect(headers()['Authorization']).toBe('Bearer jwt-token');

		await handleProxyRequest(
			proxyRequest(ALLOWED, { headers: { [UPSTREAM_BEARER_HEADER]: 'jwt-token' } }),
			{ fetchImpl }
		);
		expect(headers()['Authorization']).toBeUndefined();
	});

	it('forwards the POST body and its content type', async () => {
		let seen: RequestInit | undefined;
		const fetchImpl: FetchLike = async (_input, init) => {
			seen = init;
			return new Response('{}', { headers: { 'content-type': 'application/json' } });
		};
		await handleProxyRequest(
			proxyRequest('https://api.enablebanking.com/sessions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ code: 'abc' })
			}),
			{ fetchImpl }
		);
		const headers = (seen?.headers ?? {}) as Record<string, string>;
		expect(headers['Content-Type']).toBe('application/json');
		expect(new TextDecoder().decode((seen?.body ?? new ArrayBuffer(0)) as ArrayBuffer)).toBe(
			'{"code":"abc"}'
		);
	});
});
