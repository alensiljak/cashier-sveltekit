/*
    Tests for the client side of the CORS proxy: URL encoding, the configurable
    proxy base URL, the device `X-Proxy-Key` header, and the actionable errors
    for a rejected or unconfigured proxy.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ key: null as string | null, url: null as string | null }));

vi.mock('#lib/settings', () => ({
	deviceSettings: {
		get: vi.fn(async (key: string) =>
			key === 'proxy.key' ? state.key : key === 'proxy.url' ? state.url : null
		),
		set: vi.fn()
	},
	DeviceSettingKeys: { proxyKey: 'proxy.key', proxyUrl: 'proxy.url' }
}));

import { proxyFetch, proxyUrl } from '#lib/services/prices/proxyFetch';

beforeEach(() => {
	state.key = null;
	state.url = null;
	vi.unstubAllGlobals();
});

describe('proxyUrl', () => {
	it('encodes the target URL against the same-origin endpoint by default', async () => {
		expect(await proxyUrl('https://www.vanguard.com.au/a?b=1&c=2')).toBe(
			'/api/proxy?url=https%3A%2F%2Fwww.vanguard.com.au%2Fa%3Fb%3D1%26c%3D2'
		);
	});

	it('uses the configured proxy URL when set', async () => {
		state.url = 'https://proxy.example.com/api/proxy';
		expect(await proxyUrl('https://www.vanguard.com.au/a')).toBe(
			'https://proxy.example.com/api/proxy?url=https%3A%2F%2Fwww.vanguard.com.au%2Fa'
		);
	});

	it('trims trailing slashes from the configured proxy URL', async () => {
		state.url = 'https://proxy.example.com/api/proxy/';
		expect(await proxyUrl('https://www.vanguard.com.au/a')).toBe(
			'https://proxy.example.com/api/proxy?url=https%3A%2F%2Fwww.vanguard.com.au%2Fa'
		);
	});

	it('rejects a configured proxy URL that is not absolute http(s)', async () => {
		state.url = 'not-a-url';
		await expect(proxyUrl('https://www.vanguard.com.au/a')).rejects.toThrow(/Settings/);

		state.url = 'ftp://proxy.example.com/api/proxy';
		await expect(proxyUrl('https://www.vanguard.com.au/a')).rejects.toThrow(/http/);
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

	it('calls the configured proxy URL instead of the same-origin endpoint', async () => {
		state.url = 'https://proxy.example.com/api/proxy';
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'));
		vi.stubGlobal('fetch', fetchMock);

		await proxyFetch('https://www.vanguard.com.au/a');

		const [url] = fetchMock.mock.calls[0]!;
		expect(url).toBe(
			'https://proxy.example.com/api/proxy?url=https%3A%2F%2Fwww.vanguard.com.au%2Fa'
		);
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
