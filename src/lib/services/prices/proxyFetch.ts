/**
 * Fetch an upstream API through the app's same-origin CORS proxy
 * (`worker/proxy.ts`, doc/completed-projects/2026-11-16_CORS-proxy.md).
 *
 * Only hosts in the Worker's `ALLOWED_HOSTS` are accepted. The deployment's
 * shared `PROXY_KEY` is read from this device's settings and sent as
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

export function proxyUrl(target: string): string {
	return `${PROXY_PATH}?url=${encodeURIComponent(target)}`;
}

export interface ProxyFetchOptions extends RequestInit {
	/** Forwarded to the upstream as `X-API-KEY` (only for hosts that accept it). */
	upstreamKey?: string;
	/** Forwarded to the upstream as `Authorization: Bearer <token>`. */
	upstreamBearer?: string;
}

export async function proxyFetch(target: string, init: ProxyFetchOptions = {}): Promise<Response> {
	const { upstreamKey, upstreamBearer, ...requestInit } = init;
	const key = await deviceSettings.get<string>(DeviceSettingKeys.proxyKey);
	const headers = new Headers(requestInit.headers);
	if (key) headers.set(PROXY_KEY_HEADER, key);
	if (upstreamKey) headers.set(UPSTREAM_KEY_HEADER, upstreamKey);
	if (upstreamBearer) headers.set(UPSTREAM_BEARER_HEADER, upstreamBearer);

	const response = await fetch(proxyUrl(target), { ...requestInit, headers });
	if (response.status === 401) {
		throw new Error(
			'Proxy key is missing or invalid — set it in the Price Download configuration.'
		);
	}
	if (response.status === 503) {
		throw new Error('The price proxy is not configured on the server (PROXY_KEY is missing).');
	}
	return response;
}
