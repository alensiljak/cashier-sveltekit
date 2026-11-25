// @vitest-environment node
/*
    Tests for the Enable Banking API client (src/lib/importers/enablebanking/api.ts)
    with an injected transport: URL/query/body building, the bearer header, the
    continuation-key paging, and error mapping — no network.
*/
import { describe, expect, it, vi } from 'vitest';
import {
	EB_API_BASE,
	EbError,
	EnableBankingClient,
	ebCallbackUrl,
	type EbTransactionsResponse
} from '#lib/importers/enablebanking/api';

const CREDS = { appId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', privateKeyPem: 'pem' };
const fakeTokenSource = { getToken: vi.fn(async () => 'signed-jwt') };

interface Captured {
	url: string;
	init: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
		upstreamBearer?: string;
	};
}

function clientReturning(pages: Array<{ status?: number; body?: unknown }>): {
	client: EnableBankingClient;
	calls: Captured[];
} {
	const calls: Captured[] = [];
	let page = 0;
	const fetchImpl = vi.fn(async (url: string, init?: Captured['init']) => {
		calls.push({ url, init: init ?? {} });
		const next = pages[Math.min(page++, pages.length - 1)];
		const status = next.status ?? 200;
		// 204/304 responses must not carry a body.
		if (status === 204 || status === 304) return new Response(null, { status });
		return new Response(JSON.stringify(next.body ?? {}), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	});
	const client = new EnableBankingClient({
		credentials: CREDS,
		fetchImpl: fetchImpl as never,
		tokenSource: fakeTokenSource
	});
	return { client, calls };
}

describe('ebCallbackUrl', () => {
	it('builds the callback URL from the origin and strips trailing slashes', () => {
		expect(ebCallbackUrl('https://cashier.alensiljak.cc')).toBe(
			'https://cashier.alensiljak.cc/importers/enable-banking/callback'
		);
		expect(ebCallbackUrl('http://localhost:5173/')).toBe(
			'http://localhost:5173/importers/enable-banking/callback'
		);
	});
});

describe('EnableBankingClient request building', () => {
	it('GETs /application with the signed JWT as upstream bearer', async () => {
		const { client, calls } = clientReturning([
			{ body: { id: CREDS.appId, environment: 'SANDBOX' } }
		]);
		const app = await client.getApplication();
		expect(app.environment).toBe('SANDBOX');
		expect(calls[0].url).toBe(`${EB_API_BASE}/application`);
		expect(calls[0].init.method).toBe('GET');
		expect(calls[0].init.upstreamBearer).toBe('signed-jwt');
		expect(fakeTokenSource.getToken).toHaveBeenCalled();
	});

	it('passes country and psu_type as query params on /aspsps', async () => {
		const { client, calls } = clientReturning([{ body: { aspsps: [] } }]);
		await client.listAspsps({ country: 'DE', psuType: 'personal' });
		const url = new URL(calls[0].url);
		expect(url.pathname).toBe('/aspsps');
		expect(url.searchParams.get('country')).toBe('DE');
		expect(url.searchParams.get('psu_type')).toBe('personal');
	});

	it('POSTs /auth with the JSON body and content type', async () => {
		const { client, calls } = clientReturning([
			{ body: { url: 'https://tilisy.examplebanking.com/ais/start?x=1' } }
		]);
		const response = await client.startAuthorization({
			access: { balances: true, transactions: true, valid_until: '2026-12-24T08:51:40.863Z' },
			aspsp: { name: 'Mock ASPSP', country: 'DE' },
			state: 'state-1',
			redirect_url: 'http://localhost:5173/importers/enable-banking/callback',
			psu_type: 'personal'
		});
		expect(response.url).toContain('tilisy.examplebanking.com');
		expect(calls[0].url).toBe(`${EB_API_BASE}/auth`);
		expect(calls[0].init.method).toBe('POST');
		expect(calls[0].init.headers?.['Content-Type']).toBe('application/json');
		expect(JSON.parse(calls[0].init.body ?? '{}')).toMatchObject({
			state: 'state-1',
			aspsp: { name: 'Mock ASPSP', country: 'DE' }
		});
	});

	it('exchanges the redirect code via POST /sessions with body {code}', async () => {
		const { client, calls } = clientReturning([
			{ body: { session_id: 'sess-1', accounts: [{ uid: 'acc-1' }] } }
		]);
		const session = await client.authorizeSession('code-123');
		expect(session.session_id).toBe('sess-1');
		expect(session.accounts[0].uid).toBe('acc-1');
		expect(calls[0].init.method).toBe('POST');
		expect(JSON.parse(calls[0].init.body ?? '{}')).toEqual({ code: 'code-123' });
	});

	it('sends DELETE for session revocation', async () => {
		const { client, calls } = clientReturning([{ status: 204, body: {} }]);
		await client.deleteSession('sess-1');
		expect(calls[0].init.method).toBe('DELETE');
		expect(calls[0].url).toBe(`${EB_API_BASE}/sessions/sess-1`);
	});

	it('builds the transactions URL with date range and continuation key', async () => {
		const { client, calls } = clientReturning([{ body: { transactions: [] } }]);
		await client.getTransactions('acc 1', {
			dateFrom: '2026-01-01',
			dateTo: '2026-02-01',
			continuationKey: 'key/with+chars'
		});
		const url = new URL(calls[0].url);
		expect(url.pathname).toBe('/accounts/acc%201/transactions');
		expect(url.searchParams.get('date_from')).toBe('2026-01-01');
		expect(url.searchParams.get('date_to')).toBe('2026-02-01');
		expect(url.searchParams.get('continuation_key')).toBe('key/with+chars');
	});
});

describe('fetchAllTransactions paging', () => {
	function txPage(
		transactions: unknown[],
		continuation_key?: string
	): { body: EbTransactionsResponse } {
		return { body: { transactions: transactions as never[], continuation_key } };
	}

	it('follows continuation_key until it is absent', async () => {
		const { client, calls } = clientReturning([
			txPage([{ transaction_id: 't1' }], 'ck-1'),
			txPage([{ transaction_id: 't2' }, { transaction_id: 't3' }], 'ck-2'),
			txPage([{ transaction_id: 't4' }])
		]);
		const all = await client.fetchAllTransactions('acc-1', { dateFrom: '2026-01-01' });
		expect(all.map((t) => t.transaction_id)).toEqual(['t1', 't2', 't3', 't4']);
		expect(calls).toHaveLength(3);
		expect(new URL(calls[1].url).searchParams.get('continuation_key')).toBe('ck-1');
		expect(new URL(calls[2].url).searchParams.get('continuation_key')).toBe('ck-2');
	});

	it('stops at the page cap even if the key never disappears', async () => {
		const page = txPage([{ transaction_id: 't' }], 'ck');
		const { client, calls } = clientReturning([page]);
		const all = await client.fetchAllTransactions('acc-1', {}, 5);
		expect(all).toHaveLength(5);
		expect(calls).toHaveLength(5);
	});
});

describe('error mapping', () => {
	it('maps {error, detail} bodies to EbError with status and code', async () => {
		const { client } = clientReturning([
			{ status: 401, body: { error: 'INVALID_TOKEN', detail: 'JWT expired' } }
		]);
		const err = await client.getApplication().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(EbError);
		expect((err as EbError).status).toBe(401);
		expect((err as EbError).code).toBe('INVALID_TOKEN');
		expect((err as EbError).message).toContain('HTTP 401');
		expect((err as EbError).message).toContain('INVALID_TOKEN');
		expect((err as EbError).message).toContain('JWT expired');
	});

	it('tolerates non-JSON error bodies', async () => {
		const calls: Captured[] = [];
		const fetchImpl = vi.fn(async (url: string, init?: Captured['init']) => {
			calls.push({ url, init: init ?? {} });
			return new Response('gateway exploded', { status: 502 });
		});
		const client = new EnableBankingClient({
			credentials: CREDS,
			fetchImpl: fetchImpl as never,
			tokenSource: fakeTokenSource
		});
		const err = await client.getSession('s').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(EbError);
		expect((err as EbError).status).toBe(502);
		expect((err as EbError).code).toBeNull();
	});
});
