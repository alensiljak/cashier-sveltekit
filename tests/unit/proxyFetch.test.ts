/*
    Tests for the client side of the CORS proxy: URL encoding, the device
    `X-Proxy-Key` header, and the actionable errors for a rejected or
    unconfigured proxy.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ key: null as string | null }));

vi.mock('#lib/settings', () => ({
	deviceSettings: { get: vi.fn(async () => state.key), set: vi.fn() },
	DeviceSettingKeys: { proxyKey: 'proxy.key' }
}));

import { proxyFetch, proxyUrl } from '#lib/services/prices/proxyFetch';

beforeEach(() => {
	state.key = null;
	vi.unstubAllGlobals();
});

describe('proxyUrl', () => {
	it('encodes the target URL', () => {
		expect(proxyUrl('https://www.vanguard.com.au/a?b=1&c=2')).toBe(
			'/api/proxy?url=https%3A%2F%2Fwww.vanguard.com.au%2Fa%3Fb%3D1%26c%3D2'
		);
	});
});

describe('proxyFetch', () => {
	it('sends the device key as X-Proxy-Key', async () => {
		state.key = 'secret';
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'));
		vi.stubGlobal('fetch', fetchMock);

		await proxyFetch('https://www.vanguard.com.au/a');

		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toContain('/api/proxy?url=');
		expect(new Headers(init?.headers).get('X-Proxy-Key')).toBe('secret');
	});

	it('omits the header when no key is configured', async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'));
		vi.stubGlobal('fetch', fetchMock);

		await proxyFetch('https://www.vanguard.com.au/a');

		const [, init] = fetchMock.mock.calls[0]!;
		expect(new Headers(init?.headers).has('X-Proxy-Key')).toBe(false);
	});

	it('turns 401 and 503 into actionable errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 401 }))
		);
		await expect(proxyFetch('https://www.vanguard.com.au/a')).rejects.toThrow(/Proxy key/);

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 503 }))
		);
		await expect(proxyFetch('https://www.vanguard.com.au/a')).rejects.toThrow(/PROXY_KEY/);
	});
});
