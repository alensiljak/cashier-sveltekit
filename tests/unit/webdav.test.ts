/*
    WebDavClient tests: request shape (method, URL, auth, content type) and
    PROPFIND parsing, with fetch replaced by a spy.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebDavClient } from '$lib/utils/webdav';

const fetchMock = vi.fn();
const client = new WebDavClient('https://dav.example.com/backups', 'alice', 's3cret');
const AUTH = 'Basic ' + btoa('alice:s3cret');

beforeEach(() => {
	fetchMock.mockReset().mockResolvedValue(new Response('', { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const lastCall = () => fetchMock.mock.calls.at(-1) as [string, RequestInit];

describe('URLs', () => {
	it('joins the base URL and file name with exactly one slash', () => {
		expect(client.fileUrl('a.bean')).toBe('https://dav.example.com/backups/a.bean');
		expect(new WebDavClient('https://x/dir/', 'u', 'p').fileUrl('a.bean')).toBe(
			'https://x/dir/a.bean'
		);
	});
});

describe('put', () => {
	it('sends text with basic auth and a text content type', async () => {
		await client.put('a.bean', 'hello');

		const [url, init] = lastCall();
		expect(url).toBe('https://dav.example.com/backups/a.bean');
		expect(init).toMatchObject({ method: 'PUT', body: 'hello' });
		expect(init.headers).toEqual({
			Authorization: AUTH,
			'Content-Type': 'text/plain; charset=utf-8'
		});
	});

	it('sends bytes as a Blob with the given content type', async () => {
		await client.put('state.ydoc', new Uint8Array([1, 2, 3]), 'application/octet-stream');

		const [, init] = lastCall();
		expect(init.body).toBeInstanceOf(Blob);
		expect((init.body as Blob).size).toBe(3);
		expect((init.headers as Record<string, string>)['Content-Type']).toBe(
			'application/octet-stream'
		);
	});

	it('returns the response so callers can check ok', async () => {
		fetchMock.mockResolvedValue(new Response('', { status: 507 }));

		expect((await client.put('a', 'b')).ok).toBe(false);
	});
});

describe('get / delete', () => {
	it('gets without caching', async () => {
		await client.get('a.bean');

		expect(lastCall()[1]).toMatchObject({
			method: 'GET',
			cache: 'no-store',
			headers: { Authorization: AUTH }
		});
	});

	it('deletes', async () => {
		await client.delete('a.bean');

		expect(lastCall()[1]).toMatchObject({ method: 'DELETE', headers: { Authorization: AUTH } });
	});
});

describe('exists', () => {
	it.each([
		[200, true],
		[404, false],
		[410, false],
		[403, true],
		[500, true]
	])('HEAD %s -> %s', async (status, expected) => {
		fetchMock.mockResolvedValue(new Response('', { status }));

		expect(await client.exists('a.bean')).toBe(expected);
		expect(lastCall()[1].method).toBe('HEAD');
	});
});

describe('lastModified', () => {
	it('reads the Last-Modified header', async () => {
		fetchMock.mockResolvedValue(
			new Response('', { headers: { 'Last-Modified': 'Sat, 15 Aug 2026 10:00:00 GMT' } })
		);

		expect((await client.lastModified('a'))?.toISOString()).toBe('2026-08-15T10:00:00.000Z');
	});

	it('returns null without the header, on an error status, or when fetch fails', async () => {
		fetchMock.mockResolvedValueOnce(new Response(''));
		expect(await client.lastModified('a')).toBeNull();

		fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
		expect(await client.lastModified('a')).toBeNull();

		fetchMock.mockRejectedValueOnce(new Error('offline'));
		expect(await client.lastModified('a')).toBeNull();
	});
});

describe('list', () => {
	const multistatus = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/backups/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>/backups/cashier.bean</d:href>
    <d:propstat><d:prop>
      <d:getcontentlength>1234</d:getcontentlength>
      <d:getlastmodified>Sat, 15 Aug 2026 10:00:00 GMT</d:getlastmodified>
      <d:resourcetype/>
    </d:prop></d:propstat></d:response>
  <d:response><d:href>/backups/My%20Notes/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>`;

	it('parses entries, skipping the directory itself', async () => {
		fetchMock.mockResolvedValue(new Response(multistatus, { status: 207 }));

		const entries = await client.list();

		expect(entries).toEqual([
			{
				name: 'cashier.bean',
				isDirectory: false,
				size: 1234,
				lastModified: new Date('2026-08-15T10:00:00Z')
			},
			{ name: 'My Notes', isDirectory: true, size: null, lastModified: null }
		]);
	});

	it('asks for depth 1 with PROPFIND', async () => {
		fetchMock.mockResolvedValue(new Response(multistatus, { status: 207 }));

		await client.list();

		const [url, init] = lastCall();
		expect(url).toBe('https://dav.example.com/backups/');
		expect(init).toMatchObject({
			method: 'PROPFIND',
			headers: { Depth: '1', Authorization: AUTH }
		});
	});

	it('fails with the status when the server refuses', async () => {
		fetchMock.mockResolvedValue(new Response('', { status: 401, statusText: 'Unauthorized' }));

		await expect(client.list()).rejects.toThrow('PROPFIND failed: 401 Unauthorized');
	});
});
