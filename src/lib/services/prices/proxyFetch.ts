/**
 * Fetch an upstream API through a CORS proxy (`worker/proxy.ts`,
 * doc/completed-projects/2026-11-16_CORS-proxy.md).
 *
 * The proxy's base URL comes from this device's `proxy.url` setting; when it
 * is empty, the app's own same-origin `/api/proxy` endpoint is used. Only
 * hosts in the proxy's `ALLOWED_HOSTS` are accepted. The deployment's shared
 * `PROXY_KEY` is read from this device's `proxy.key` setting and sent as
 * `X-Proxy-Key`; it is never bundled into the app or exported with settings.
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
	PROXY_KEY_HEADER,
	PROXY_PATH,
	UPSTREAM_BEARER_HEADER,
	UPSTREAM_KEY_HEADER
} from './proxyProtocol';

/**
 * The proxy endpoint to call: the device's configured `proxy.url`, or the
 * same-origin `PROXY_PATH` when none is set. A configured value must be an
 * absolute http(s) URL; anything else fails with an actionable error.
 */
export async function proxyBase(): Promise<string> {
	const configured = ((await deviceSettings.get<string>(DeviceSettingKeys.proxyUrl)) ?? '').trim();
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
}

export async function proxyFetch(target: string, init: ProxyFetchOptions = {}): Promise<Response> {
	const { upstreamKey, upstreamBearer, ...requestInit } = init;
	const [key, url] = await Promise.all([
		deviceSettings.get<string>(DeviceSettingKeys.proxyKey),
		proxyUrl(target)
	]);
	const headers = new Headers(requestInit.headers);
	if (key) headers.set(PROXY_KEY_HEADER, key);
	if (upstreamKey) headers.set(UPSTREAM_KEY_HEADER, upstreamKey);
	if (upstreamBearer) headers.set(UPSTREAM_BEARER_HEADER, upstreamBearer);

	const response = await fetch(url, { ...requestInit, headers });
	if (response.status === 401) {
		throw new Error(
			'Proxy key is missing or invalid — set it in Settings → Device Settings (HTTP Proxy).'
		);
	}
	if (response.status === 503) {
		throw new Error('The price proxy is not configured on the server (PROXY_KEY is missing).');
	}
	return response;
}
