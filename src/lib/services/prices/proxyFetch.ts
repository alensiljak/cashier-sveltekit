/**
 * Fetch an upstream API through a CORS proxy (`worker/proxy.ts`,
 * doc/completed-projects/2026-11-16_CORS-proxy.md).
 *
 * The proxy's base URL and key come from this device's `proxy` setting; when
 * the URL is empty, the app's own same-origin `/api/proxy` endpoint is used.
 * Only hosts in the proxy's `ALLOWED_HOSTS` are accepted. The key is the
 * deployment's shared `PROXY_KEY`, sent as `X-Proxy-Key`. It is never bundled
 * into the app or synced, and a backup holds it only encrypted.
 * Providers whose source sends CORS headers (ECB via Frankfurter) keep calling
 * `fetch` directly; this helper is for the closed-off sources.
 *
 * A caller's own credential travels in `X-Upstream-Key` (forwarded as
 * `X-API-KEY`) or `X-Upstream-Authorization` (forwarded as
 * `Authorization: Bearer …`); the proxy passes each only to the hosts that
 * need it. POST bodies are forwarded as-is, with their content type.
 */

import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import {
	PROXY_ERROR_BAD_KEY,
	PROXY_ERROR_NOT_CONFIGURED,
	PROXY_KEY_HEADER,
	PROXY_PATH,
	UPSTREAM_BEARER_HEADER,
	UPSTREAM_KEY_HEADER,
	UPSTREAM_PSU_HEADER,
	UPSTREAM_SESSION_HEADER
} from './proxyProtocol';

export interface ProxySettings {
	url: string;
	key: string;
}

/** This device's proxy connection; both fields are empty when not set. */
export async function loadProxySettings(): Promise<ProxySettings> {
	const saved = await deviceSettings.get<Partial<ProxySettings>>(DeviceSettingKeys.proxy);
	return { url: (saved?.url ?? '').trim(), key: (saved?.key ?? '').trim() };
}

export async function saveProxySettings({ url, key }: ProxySettings): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.proxy, { url, key });
}

/**
 * The proxy endpoint to call: the device's configured proxy URL, or the
 * same-origin `PROXY_PATH` when none is set. A configured value must be an
 * absolute http(s) URL; anything else fails with an actionable error.
 */
export async function proxyBase(): Promise<string> {
	const configured = (await loadProxySettings()).url;
	if (!configured) return PROXY_PATH;
	let url: URL;
	try {
		url = new URL(configured);
	} catch {
		throw new Error(
			`"${configured}" is not a valid proxy URL — fix it in Settings → Device Settings (HTTP Proxy).`
		);
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error(
			`The proxy URL must start with http:// or https:// — fix it in Settings → Device Settings (HTTP Proxy).`
		);
	}
	return (url.origin + url.pathname).replace(/\/+$/, '');
}

export async function proxyUrl(target: string): Promise<string> {
	return `${await proxyBase()}?url=${encodeURIComponent(target)}`;
}

export interface ProxyFetchOptions extends RequestInit {
	/** Forwarded to the upstream as `X-API-KEY` (only for hosts that accept it). */
	upstreamKey?: string;
	/** Forwarded to the upstream as `Authorization: Bearer <token>`. */
	upstreamBearer?: string;
	/** Forwarded to MCP hosts as `Mcp-Session-Id` (only for hosts in `MCP_HOSTS`). */
	upstreamSessionId?: string;
	/** PSU header names the proxy should fill in (only for hosts in `PSU_HOSTS`). */
	upstreamPsuHeaders?: string[];
}

/** The `error` text of a JSON error response, read without consuming the body. */
async function errorText(response: Response): Promise<unknown> {
	try {
		return ((await response.clone().json()) as { error?: unknown } | null)?.error;
	} catch {
		return undefined;
	}
}

export async function proxyFetch(target: string, init: ProxyFetchOptions = {}): Promise<Response> {
	const { upstreamKey, upstreamBearer, upstreamSessionId, upstreamPsuHeaders, ...requestInit } =
		init;
	const [{ key }, url] = await Promise.all([loadProxySettings(), proxyUrl(target)]);
	const headers = new Headers(requestInit.headers);
	if (key) headers.set(PROXY_KEY_HEADER, key);
	if (upstreamKey) headers.set(UPSTREAM_KEY_HEADER, upstreamKey);
	if (upstreamBearer) headers.set(UPSTREAM_BEARER_HEADER, upstreamBearer);
	if (upstreamSessionId) headers.set(UPSTREAM_SESSION_HEADER, upstreamSessionId);
	if (upstreamPsuHeaders?.length) headers.set(UPSTREAM_PSU_HEADER, upstreamPsuHeaders.join(','));

	const response = await fetch(url, { ...requestInit, headers });
	// Only the proxy's own errors are rewritten; an upstream 401/503 reaches the caller.
	if (response.status === 401 && (await errorText(response)) === PROXY_ERROR_BAD_KEY) {
		throw new Error(
			'Proxy key is missing or invalid — set it in Settings → Device Settings (HTTP Proxy).'
		);
	}
	if (response.status === 503 && (await errorText(response)) === PROXY_ERROR_NOT_CONFIGURED) {
		throw new Error('The price proxy is not configured on the server (PROXY_KEY is missing).');
	}
	return response;
}
