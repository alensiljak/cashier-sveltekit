// @vitest-environment node
/*
    Tests for the MCP Streamable HTTP client (src/lib/importers/scalable/mcp.ts).
    The transport is injected, so no network and no settings store are touched;
    '#lib/settings' is mocked because proxyFetch (the default transport) reads it.
*/
import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/settings', () => ({
	deviceSettings: { get: vi.fn(async () => null), set: vi.fn() },
	DeviceSettingKeys: { proxy: 'proxy' }
}));

import {
	McpClient,
	McpError,
	parseSseResponse,
	SCALABLE_MCP_URL
} from '#lib/importers/scalable/mcp';

interface Call {
	target: string;
	msg: Record<string, unknown>;
	init: { headers?: Record<string, string>; upstreamBearer?: string; upstreamSessionId?: string };
}

/** Build a fetchImpl that answers per JSON-RPC method from a handler map. */
function mcpFetch(
	handlers: Record<
		string,
		(msg: Record<string, unknown>, call: Call) => Response | Promise<Response>
	>
) {
	const calls: Call[] = [];
	const fetchImpl = vi.fn(async (target: string, init?: Record<string, unknown>) => {
		const msg = JSON.parse(String(init?.body)) as Record<string, unknown>;
		const call: Call = { target, msg, init: init as Call['init'] };
		calls.push(call);
		const handler = handlers[String(msg.method)];
		if (!handler) return new Response('{"error":"no handler"}', { status: 500 });
		return handler(msg, call);
	});
	return { calls, fetchImpl: fetchImpl as never };
}

/** Fake token source: `token` is returned by getToken, refresh always fails. */
function source(token = 'tok') {
	return { getToken: async () => token, refresh: async () => null };
}

function jsonRpc(id: unknown, result: unknown): Response {
	return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

const INIT = (msg: Record<string, unknown>): Response => {
	const res = jsonRpc(msg.id, {
		protocolVersion: '2025-06-18',
		capabilities: {},
		serverInfo: { name: 'sc', version: '1' }
	});
	return new Response(res.body, {
		status: 200,
		headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-1' }
	});
};

describe('McpClient', () => {
	it('runs the initialize handshake and reuses the session id', async () => {
		const { calls, fetchImpl } = mcpFetch({
			initialize: INIT,
			'notifications/initialized': () => new Response(null, { status: 202 }),
			'tools/call': (msg) => jsonRpc(msg.id, { content: [{ type: 'text', text: '{"ok":true}' }] })
		});
		const client = new McpClient({ tokenSource: source(), fetchImpl });
		const result = await client.callTool<{ ok: boolean }>('ping');

		expect(result).toEqual({ ok: true });
		expect(calls.map((c) => c.msg.method)).toEqual([
			'initialize',
			'notifications/initialized',
			'tools/call'
		]);
		expect(calls[0]!.target).toBe(SCALABLE_MCP_URL);
		// Every call carries the bearer token; the session id appears after initialize.
		expect(calls[0]!.init.upstreamBearer).toBe('tok');
		expect(calls[0]!.init.upstreamSessionId).toBeUndefined();
		expect(calls[1]!.init.upstreamSessionId).toBe('sess-1');
		expect(calls[2]!.init.upstreamSessionId).toBe('sess-1');
		// tools/call carries the arguments.
		expect(calls[2]!.msg.params).toEqual({ name: 'ping', arguments: {} });
	});

	it('prefers structuredContent over text content', async () => {
		const { fetchImpl } = mcpFetch({
			initialize: INIT,
			'notifications/initialized': () => new Response(null, { status: 202 }),
			'tools/call': (msg) =>
				jsonRpc(msg.id, {
					structuredContent: { valuation: { total: 42 } },
					content: [{ type: 'text', text: '{"ignored":true}' }]
				})
		});
		const client = new McpClient({ tokenSource: source(), fetchImpl });
		expect(await client.callTool('get_portfolio_overview')).toEqual({ valuation: { total: 42 } });
	});

	it('parses a text content block as JSON, falling back to raw text', async () => {
		let n = 0;
		const { fetchImpl } = mcpFetch({
			initialize: INIT,
			'notifications/initialized': () => new Response(null, { status: 202 }),
			'tools/call': (msg) =>
				jsonRpc(msg.id, {
					content: [{ type: 'text', text: n++ === 0 ? '{"a":1}' : 'plain text' }]
				})
		});
		const client = new McpClient({ tokenSource: source(), fetchImpl });
		expect(await client.callTool('t1')).toEqual({ a: 1 });
		expect(await client.callTool('t2')).toBe('plain text');
	});

	it('handles text/event-stream responses', async () => {
		const { fetchImpl } = mcpFetch({
			initialize: INIT,
			'notifications/initialized': () => new Response(null, { status: 202 }),
			'tools/call': (msg) =>
				new Response(
					`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 999, result: { content: [] } })}\n\n` +
						`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { structuredContent: { via: 'sse' } } })}\n\n`,
					{ status: 200, headers: { 'Content-Type': 'text/event-stream' } }
				)
		});
		const client = new McpClient({ tokenSource: source(), fetchImpl });
		expect(await client.callTool('get_wealth_overview')).toEqual({ via: 'sse' });
	});

	it('maps 401/403 to a token error', async () => {
		const { fetchImpl } = mcpFetch({
			initialize: () => new Response('{"error":"unauthorized"}', { status: 401 })
		});
		const client = new McpClient({ tokenSource: source('bad'), fetchImpl });
		await expect(client.callTool('ping')).rejects.toThrow(McpError);
		await expect(
			new McpClient({ tokenSource: source('bad'), fetchImpl }).callTool('ping')
		).rejects.toThrow(/rejected the token/);
	});

	it('refreshes the token on a 401 and retries once', async () => {
		let calls = 0;
		const { calls: seen, fetchImpl } = mcpFetch({
			initialize: (msg) => {
				calls++;
				return calls === 1 ? new Response('{"error":"unauthorized"}', { status: 401 }) : INIT(msg);
			},
			'notifications/initialized': () => new Response(null, { status: 202 }),
			'tools/call': (msg) => jsonRpc(msg.id, { structuredContent: { ok: true } })
		});
		let token = 'expired';
		const tokenSource = {
			getToken: async () => token,
			refresh: async () => {
				token = 'fresh';
				return token;
			}
		};
		const client = new McpClient({ tokenSource, fetchImpl });
		expect(await client.callTool('ping')).toEqual({ ok: true });
		// The retried initialize carries the fresh token.
		expect(seen[1]!.init.upstreamBearer).toBe('fresh');
	});

	it('surfaces JSON-RPC errors and tool-level isError results', async () => {
		const { fetchImpl } = mcpFetch({
			initialize: INIT,
			'notifications/initialized': () => new Response(null, { status: 202 }),
			'tools/call': (msg) => {
				const name = (msg.params as Record<string, unknown>).name;
				if (name === 'rpc_error')
					return new Response(
						JSON.stringify({
							jsonrpc: '2.0',
							id: msg.id,
							error: { code: -32602, message: 'bad params' }
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } }
					);
				return jsonRpc(msg.id, {
					isError: true,
					content: [{ type: 'text', text: 'insufficient funds' }]
				});
			}
		});
		const client = new McpClient({ tokenSource: source(), fetchImpl });
		await expect(client.callTool('rpc_error')).rejects.toThrow(/bad params/);
		await expect(client.callTool('other')).rejects.toThrow(/insufficient funds/);
	});

	it('lists tool names from tools/list', async () => {
		const { fetchImpl } = mcpFetch({
			initialize: INIT,
			'notifications/initialized': () => new Response(null, { status: 202 }),
			'tools/list': (msg) =>
				jsonRpc(msg.id, { tools: [{ name: 'ping' }, { name: 'get_portfolio_overview' }] })
		});
		const client = new McpClient({ tokenSource: source(), fetchImpl });
		expect(await client.listTools()).toEqual(['ping', 'get_portfolio_overview']);
	});
});

describe('parseSseResponse', () => {
	it('returns the message with the matching id and throws on error messages', () => {
		const body =
			`data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: 1 } })}\n\n` +
			`data: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { ok: 2 } })}\n\n`;
		expect(parseSseResponse(body, 2)).toEqual({ jsonrpc: '2.0', id: 2, result: { ok: 2 } });
		expect(() =>
			parseSseResponse(
				`data: ${JSON.stringify({ jsonrpc: '2.0', id: 3, error: { code: -1, message: 'boom' } })}\n\n`,
				3
			)
		).toThrow(/boom/);
		expect(parseSseResponse('data: not json\n\ndata: {}\n\n', undefined)).toEqual({});
	});
});
