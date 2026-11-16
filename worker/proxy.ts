/**
 * Generic same-origin CORS proxy for price sources that do not send
 * `Access-Control-Allow-Origin` for the app's origin
 * (doc/projects/2026-11-16_CORS-proxy.md).
 *
 * The proxy is deliberately narrow: GET only, HTTPS only, exact-host
 * allowlist, no client headers forwarded (Origin/Referer/Cookie in particular
 * make some upstreams reject the request), redirects rejected, a 15 s timeout
 * and a response-size cap. It is not an open relay.
 *
 * The same handler runs in the Cloudflare Worker (`worker/index.ts`) and in
 * Vite's dev/preview middleware (see `vite.config.ts`), so providers see one
 * URL in every environment.
 */

import {
	PROXY_KEY_HEADER,
	PROXY_PATH,
	UPSTREAM_KEY_HEADER
} from '../src/lib/services/prices/proxyProtocol.ts';

export { PROXY_KEY_HEADER, PROXY_PATH, UPSTREAM_KEY_HEADER };

/**
 * Hosts the proxy may fetch. Add a provider's source host here when adding a
 * downloader; keeping the list closed prevents the public endpoint from being
 * used as an open proxy.
 */
export const ALLOWED_HOSTS: Record<string, true> = {
	'www.ecb.europa.eu': true,
	'www.vanguard.com.au': true,
	'api.aware.com.au': true
};

/**
 * Hosts that need an API key from the user. The client's `X-Upstream-Key`
 * value is forwarded as `X-API-KEY` to these hosts only; for any other host
 * it is dropped.
 */
export const UPSTREAM_KEY_HOSTS: Record<string, true> = {
	'api.aware.com.au': true
};

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const USER_AGENT = 'Cashier price proxy (+https://cashier.alensiljak.cc)';

export class ProxyRequestError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'ProxyRequestError';
	}
}

/** Parse and validate the `url` query parameter. Exported for unit tests. */
export function resolveProxyTarget(raw: string | null): URL {
	if (!raw) throw new ProxyRequestError(400, 'Missing url parameter');

	let target: URL;
	try {
		target = new URL(raw);
	} catch {
		throw new ProxyRequestError(400, 'Invalid url parameter');
	}

	if (target.protocol !== 'https:') {
		throw new ProxyRequestError(400, 'Only https URLs are allowed');
	}
	if (target.username || target.password) {
		throw new ProxyRequestError(400, 'Credentials in the URL are not allowed');
	}
	if (!Object.hasOwn(ALLOWED_HOSTS, target.hostname)) {
		throw new ProxyRequestError(403, `Host not allowed: ${target.hostname}`);
	}
	return target;
}

export function isProxyRequest(request: Request): boolean {
	return new URL(request.url).pathname === PROXY_PATH;
}

function errorResponse(status: number, message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store'
		}
	});
}

/** Only pass through content types a price downloader can actually consume. */
function responseContentType(upstream: Response): string {
	const type = upstream.headers.get('content-type') ?? '';
	if (/^(application\/(json|xml)|text\/)/i.test(type)) return type;
	return 'application/octet-stream';
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ProxyOptions {
	/** Injectable fetch for unit tests. */
	fetchImpl?: FetchLike;
	/** When set, requests must carry a matching `X-Proxy-Key` header. */
	requiredKey?: string;
	/**
	 * Fail closed when no key is configured. The deployed Worker sets this so
	 * a missing `PROXY_KEY` secret cannot silently expose an open proxy; the
	 * Vite dev/preview middleware leaves it off.
	 */
	requireKey?: boolean;
}

/**
 * Compare the shared key without short-circuiting on the first differing
 * character. Length is not treated as secret.
 */
function keysMatch(provided: string, expected: string): boolean {
	if (provided.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < provided.length; i++) {
		diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return diff === 0;
}

/**
 * Handle `GET /api/proxy?url=<absolute https URL>`. The fetch and key policy
 * are injectable so the unit tests exercise the real handler without touching
 * the network.
 */
export async function handleProxyRequest(
	request: Request,
	options: ProxyOptions = {}
): Promise<Response> {
	if (options.requireKey || options.requiredKey !== undefined) {
		if (!options.requiredKey) {
			return errorResponse(503, 'Proxy key is not configured');
		}
		const provided = request.headers.get(PROXY_KEY_HEADER) ?? '';
		if (!keysMatch(provided, options.requiredKey)) {
			return errorResponse(401, 'Invalid proxy key');
		}
	}

	if (request.method !== 'GET') {
		return errorResponse(405, 'Only GET requests are allowed');
	}

	let target: URL;
	try {
		target = resolveProxyTarget(new URL(request.url).searchParams.get('url'));
	} catch (err) {
		if (err instanceof ProxyRequestError) return errorResponse(err.status, err.message);
		throw err;
	}

	const fetchImpl = options.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		// Never forward the browser's Origin/Referer/Cookie: several price
		// sources reject foreign origins outright (Vanguard answers 500).
		const upstreamHeaders: Record<string, string> = {
			Accept: 'application/json, text/plain, */*',
			'User-Agent': USER_AGENT
		};
		const upstreamKey = request.headers.get(UPSTREAM_KEY_HEADER);
		if (upstreamKey && Object.hasOwn(UPSTREAM_KEY_HOSTS, target.hostname)) {
			upstreamHeaders['X-API-KEY'] = upstreamKey;
		}
		const upstream = await fetchImpl(target, {
			method: 'GET',
			headers: upstreamHeaders,
			redirect: 'manual',
			signal: controller.signal
		});

		if (upstream.status >= 300 && upstream.status < 400) {
			return errorResponse(502, 'Upstream redirected; redirects are not followed');
		}

		const body = await upstream.arrayBuffer();
		if (body.byteLength > MAX_RESPONSE_BYTES) {
			return errorResponse(502, `Upstream response exceeds ${MAX_RESPONSE_BYTES} bytes`);
		}

		// 204/205/304 must not carry a body; constructing a Response with one throws.
		const nullBody = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
		return new Response(nullBody ? null : body, {
			status: upstream.status,
			headers: {
				'Content-Type': responseContentType(upstream),
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff'
			}
		});
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			return errorResponse(504, `Upstream timed out after ${TIMEOUT_MS / 1000}s`);
		}
		const message = err instanceof Error ? err.message : String(err);
		return errorResponse(502, `Upstream request failed: ${message}`);
	} finally {
		clearTimeout(timer);
	}
}
