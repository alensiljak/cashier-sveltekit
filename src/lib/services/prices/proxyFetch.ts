/**
 * Fetch a price source through the app's same-origin CORS proxy
 * (`worker/proxy.ts`, doc/projects/2026-11-16_CORS-proxy.md).
 *
 * Only hosts in the Worker's `ALLOWED_HOSTS` are accepted. The deployment's
 * shared `PROXY_KEY` is read from this device's settings and sent as
 * `X-Proxy-Key`; it is never bundled into the app or exported with settings.
 * Providers whose source sends CORS headers (ECB via Frankfurter) keep calling
 * `fetch` directly; this helper is for the closed-off sources.
 */

import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { PROXY_KEY_HEADER, PROXY_PATH } from './proxyProtocol';

export function proxyUrl(target: string): string {
	return `${PROXY_PATH}?url=${encodeURIComponent(target)}`;
}

export async function proxyFetch(target: string, init?: RequestInit): Promise<Response> {
	const key = await deviceSettings.get<string>(DeviceSettingKeys.proxyKey);
	const headers = new Headers(init?.headers);
	if (key) headers.set(PROXY_KEY_HEADER, key);

	const response = await fetch(proxyUrl(target), { ...init, headers });
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
