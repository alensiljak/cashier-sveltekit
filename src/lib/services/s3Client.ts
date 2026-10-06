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
