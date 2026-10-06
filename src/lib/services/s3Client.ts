import { AwsClient } from 'aws4fetch';
import type { S3Config } from './s3Config';

export interface S3TestStep {
	name: 'Upload' | 'Download' | 'Delete';
	ok: boolean;
	/** Failure details, or a short success note. */
	message: string;
}

function createClient(cfg: S3Config): AwsClient {
	return new AwsClient({
		accessKeyId: cfg.accessKeyId,
		secretAccessKey: cfg.secretAccessKey,
		service: 's3',
		region: cfg.region || 'auto'
	});
}

/** Path-style object URL: <endpoint>/<bucket>/<prefix>/<key>. */
export function objectUrl(cfg: S3Config, key: string): string {
	const prefix = cfg.prefix.replace(/^\/+|\/+$/g, '');
	const fullKey = prefix ? `${prefix}/${key}` : key;
	const encoded = fullKey.split('/').map(encodeURIComponent).join('/');
	return `${cfg.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(cfg.bucket)}/${encoded}`;
}

/** Thrown for a non-2xx response, so callers can tell e.g. 404 and 412 from real failures. */
export class S3HttpError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'S3HttpError';
	}
}

/** Uploads an object. With `onlyIfAbsent`, returns false instead of overwriting an existing one. */
export async function putObject(
	cfg: S3Config,
	key: string,
	body: Uint8Array<ArrayBuffer> | string,
	opts: { contentType?: string; onlyIfAbsent?: boolean } = {}
): Promise<boolean> {
	const headers: Record<string, string> = {
		'Content-Type': opts.contentType ?? 'application/octet-stream'
	};
	if (opts.onlyIfAbsent) headers['If-None-Match'] = '*';
	const res = await createClient(cfg).fetch(objectUrl(cfg, key), { method: 'PUT', body, headers });
	if (res.status === 412) return false;
	if (!res.ok) throw new S3HttpError(res.status, describeStatus(res));
	return true;
}

/** Downloads an object, or null when it does not exist. */
export async function getObject(
	cfg: S3Config,
	key: string
): Promise<Uint8Array<ArrayBuffer> | null> {
	const res = await createClient(cfg).fetch(objectUrl(cfg, key), { method: 'GET' });
	if (res.status === 404) return null;
	if (!res.ok) throw new S3HttpError(res.status, describeStatus(res));
	return new Uint8Array(await res.arrayBuffer());
}

/** Keys (relative to the configured prefix) of all objects whose key starts with `keyPrefix`. */
export async function listObjects(cfg: S3Config, keyPrefix: string): Promise<string[]> {
	const client = createClient(cfg);
	const base = cfg.prefix.replace(/^\/+|\/+$/g, '');
	const fullPrefix = base ? `${base}/${keyPrefix}` : keyPrefix;
	const keys: string[] = [];
	let token: string | undefined;

	do {
		const params = new URLSearchParams({ 'list-type': '2', prefix: fullPrefix });
		if (token) params.set('continuation-token', token);
		const url = `${cfg.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(cfg.bucket)}?${params}`;
		const res = await client.fetch(url, { method: 'GET' });
		if (!res.ok) throw new S3HttpError(res.status, describeStatus(res));
		const page = parseListResponse(await res.text());
		for (const key of page.keys) keys.push(base ? key.slice(base.length + 1) : key);
		token = page.nextToken;
	} while (token);

	return keys;
}

export function parseListResponse(xml: string): { keys: string[]; nextToken?: string } {
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	const keys = Array.from(doc.getElementsByTagName('Contents'), (c) => {
		return c.getElementsByTagName('Key')[0]?.textContent ?? '';
	}).filter(Boolean);
	const truncated = doc.getElementsByTagName('IsTruncated')[0]?.textContent === 'true';
	const nextToken = doc.getElementsByTagName('NextContinuationToken')[0]?.textContent;
	return { keys, nextToken: truncated && nextToken ? nextToken : undefined };
}

/** Deletes an object. Succeeds when it is already gone. */
export async function deleteObject(cfg: S3Config, key: string): Promise<void> {
	const res = await createClient(cfg).fetch(objectUrl(cfg, key), { method: 'DELETE' });
	if (!res.ok && res.status !== 404) throw new S3HttpError(res.status, describeStatus(res));
}

export interface S3FileEntry {
	/** Name within the listed folder. */
	name: string;
	size: number;
	lastModified: Date | null;
}

export interface S3Directory {
	/** Sub-folder names, without a trailing slash. */
	folders: string[];
	files: S3FileEntry[];
}

/** One level of the bucket below `path` (no leading or trailing slash), like a folder listing. */
export async function listDirectory(cfg: S3Config, path: string): Promise<S3Directory> {
	const client = createClient(cfg);
	const base = cfg.prefix.replace(/^\/+|\/+$/g, '');
	const parts = [base, path].filter(Boolean);
	const fullPrefix = parts.length ? parts.join('/') + '/' : '';
	const result: S3Directory = { folders: [], files: [] };
	let token: string | undefined;

	do {
		const params = new URLSearchParams({ 'list-type': '2', prefix: fullPrefix, delimiter: '/' });
		if (token) params.set('continuation-token', token);
		const url = `${cfg.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(cfg.bucket)}?${params}`;
		const res = await client.fetch(url, { method: 'GET' });
		if (!res.ok) throw new S3HttpError(res.status, describeStatus(res));
		const page = parseDirectoryResponse(await res.text(), fullPrefix);
		result.folders.push(...page.folders);
		result.files.push(...page.files);
		token = page.nextToken;
	} while (token);

	return result;
}

export function parseDirectoryResponse(
	xml: string,
	fullPrefix: string
): S3Directory & { nextToken?: string } {
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	const text = (el: Element, tag: string) => el.getElementsByTagName(tag)[0]?.textContent ?? '';

	const folders = Array.from(doc.getElementsByTagName('CommonPrefixes'), (c) =>
		text(c, 'Prefix').slice(fullPrefix.length).replace(/\/$/, '')
	).filter(Boolean);
	const files: S3FileEntry[] = [];
	for (const c of Array.from(doc.getElementsByTagName('Contents'))) {
		const name = text(c, 'Key').slice(fullPrefix.length);
		// The folder's own placeholder object (key ending in "/") is not a file.
		if (!name || name.endsWith('/')) continue;
		const modified = text(c, 'LastModified');
		files.push({
			name,
			size: Number(text(c, 'Size')) || 0,
			lastModified: modified ? new Date(modified) : null
		});
	}
	const truncated = doc.getElementsByTagName('IsTruncated')[0]?.textContent === 'true';
	const nextToken = doc.getElementsByTagName('NextContinuationToken')[0]?.textContent;
	return { folders, files, nextToken: truncated && nextToken ? nextToken : undefined };
}

export function describeS3Error(e: unknown): string {
	return describeError(e);
}

function describeError(e: unknown): string {
	if (e instanceof TypeError) {
		// fetch() rejects with TypeError for network failures, including CORS blocks.
		return 'Network error. Check the endpoint and the bucket CORS policy.';
	}
	return e instanceof Error ? e.message : String(e);
}

function describeStatus(res: Response): string {
	switch (res.status) {
		case 403:
			return '403 Forbidden. Check the credentials, token permissions and device clock.';
		case 404:
			return '404 Not found. Check the endpoint and bucket name.';
		default:
			return `${res.status} ${res.statusText}`.trim();
	}
}

/**
 * Verifies the configuration by uploading a small text file, reading it back and deleting it.
 * Stops at the first failing step. The returned list contains the steps that were attempted.
 */
export async function testConnection(cfg: S3Config): Promise<S3TestStep[]> {
	const client = createClient(cfg);
	const url = objectUrl(cfg, `.cashier-test-${Date.now()}.txt`);
	const content = `Cashier connection test ${new Date().toISOString()}`;
	const steps: S3TestStep[] = [];

	const run = async (
		name: S3TestStep['name'],
		request: () => Promise<Response>,
		check?: (res: Response) => Promise<string | null>
	): Promise<boolean> => {
		try {
			const res = await request();
			if (!res.ok) {
				steps.push({ name, ok: false, message: describeStatus(res) });
				return false;
			}
			const problem = check ? await check(res) : null;
			steps.push({ name, ok: !problem, message: problem ?? 'OK' });
			return !problem;
		} catch (e) {
			steps.push({ name, ok: false, message: describeError(e) });
			return false;
		}
	};

	const uploaded = await run('Upload', () =>
		client.fetch(url, { method: 'PUT', body: content, headers: { 'Content-Type': 'text/plain' } })
	);
	if (!uploaded) return steps;

	await run(
		'Download',
		() => client.fetch(url, { method: 'GET' }),
		async (res) => ((await res.text()) === content ? null : 'Downloaded content does not match')
	);

	// Always try to clean up once the upload has succeeded.
	await run('Delete', () => client.fetch(url, { method: 'DELETE' }));
	return steps;
}
