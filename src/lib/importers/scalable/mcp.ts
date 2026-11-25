/**
 * Minimal MCP (Model Context Protocol) Streamable HTTP client for the
 * Scalable Capital endpoint. Calls go through the app's same-origin CORS
 * proxy (proxyFetch), which forwards the user's token as
 * `Authorization: Bearer …` to `mcp.scalable.capital` only.
 *
 * Protocol notes (MCP Streamable HTTP):
 * - every message is a JSON-RPC 2.0 POST with `Accept: application/json, text/event-stream`;
 * - the server answers either `application/json` or `text/event-stream` (SSE);
 * - the `initialize` response may carry a `Mcp-Session-Id` header that must be
 *   sent back on all later requests (the proxy passes it through both ways);
 * - after `initialize`, the client sends the `notifications/initialized`
 *   notification (answered with 202 and no body).
 */
import { proxyFetch } from '#lib/services/prices/proxyFetch';
import { MCP_SESSION_HEADER } from '#lib/services/prices/proxyProtocol';

export const SCALABLE_MCP_URL = 'https://mcp.scalable.capital/mcp';

/** Latest MCP protocol revision this client speaks; the server negotiates down if needed. */
const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'cashier', version: '1.0.0' };

export class McpError extends Error {
	constructor(
		readonly status: number | null,
		message: string
	) {
		super(message);
		this.name = 'McpError';
	}
}

type Json = Record<string, unknown>;

interface JsonRpcResponse {
	jsonrpc?: string;
	id?: number;
	result?: Json;
	error?: { code?: number; message?: string };
}

/**
 * Supplies the bearer token for MCP calls. `refresh` is called on a 401 so the
 * client can retry once with a fresh token (see auth.ts for the OAuth-backed one).
 */
export interface McpTokenSource {
	/** A currently valid access token (refreshing proactively if expired). */
	getToken(): Promise<string>;
	/** Return a fresh token after a 401, or null when the user must log in again. */
	refresh(): Promise<string | null>;
}

export interface McpClientOptions {
	tokenSource: McpTokenSource;
	url?: string;
	/** Injectable transport, for unit tests. Defaults to the CORS proxy. */
	fetchImpl?: typeof proxyFetch;
}

export class McpClient {
	private sessionId: string | null = null;
	private nextId = 1;
	private initialized = false;
	private readonly url: string;
	private readonly fetchImpl: typeof proxyFetch;

	constructor(private readonly options: McpClientOptions) {
		this.url = options.url ?? SCALABLE_MCP_URL;
		this.fetchImpl = options.fetchImpl ?? proxyFetch;
	}

	get sessionActive(): boolean {
		return this.initialized;
	}

	/** Run `initialize` + the `notifications/initialized` handshake. Safe to call once per client. */
	async initialize(): Promise<void> {
		if (this.initialized) return;
		const init = await this.post({
			jsonrpc: '2.0',
			id: this.nextId++,
			method: 'initialize',
			params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }
		});
		if (!init?.result) throw new McpError(null, 'MCP server returned no initialize result');
		// Notification: 202 Accepted with no body is expected.
		await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, true);
		this.initialized = true;
	}

	/** Call an MCP tool and return its structured result. */
	async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
		await this.initialize();
		const response = await this.post({
			jsonrpc: '2.0',
			id: this.nextId++,
			method: 'tools/call',
			params: { name, arguments: args }
		});
		if (!response?.result) throw new McpError(null, `Tool ${name} returned no result`);
		const result = response.result;
		if (result.isError === true) {
			throw new McpError(null, `Tool ${name} failed: ${toolText(result)}`);
		}
		return unwrapResult(result) as T;
	}

	/** List the tools the server offers (used to verify the connection). */
	async listTools(): Promise<string[]> {
		await this.initialize();
		const response = await this.post({
			jsonrpc: '2.0',
			id: this.nextId++,
			method: 'tools/list',
			params: {}
		});
		const tools = (response?.result?.tools as Json[] | undefined) ?? [];
		return tools.map((t) => String(t.name ?? '')).filter(Boolean);
	}

	/**
	 * POST one JSON-RPC message. Returns the matching response, or null for
	 * notifications (202 with no body, or any body when `isNotification`).
	 * Handles both JSON and SSE responses. On a 401/403 the token is refreshed
	 * once and the request retried.
	 */
	private async post(
		message: Json,
		isNotification = false,
		allowRetry = true
	): Promise<JsonRpcResponse | null> {
		const response = await this.fetchImpl(this.url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(message),
			upstreamBearer: await this.options.tokenSource.getToken(),
			upstreamSessionId: this.sessionId ?? undefined
		});

		// The proxy passes upstream statuses through; 401/403 mean the token was rejected.
		if ((response.status === 401 || response.status === 403) && allowRetry) {
			const fresh = await this.options.tokenSource.refresh();
			if (fresh) return this.post(message, isNotification, false);
			throw new McpError(
				response.status,
				'Scalable Capital rejected the token (401/403) and it could not be refreshed — connect again on the Importers page.'
			);
		}
		if (response.status === 401 || response.status === 403) {
			throw new McpError(
				response.status,
				'Scalable Capital rejected the token (401/403) — connect again on the Importers page.'
			);
		}
		if (!response.ok) {
			const detail = (await response.text().catch(() => '')).slice(0, 300);
			throw new McpError(
				response.status,
				`MCP request failed (HTTP ${response.status}): ${detail}`
			);
		}

		const sid = response.headers.get(MCP_SESSION_HEADER);
		if (sid) this.sessionId = sid;

		if (response.status === 202 || isNotification) {
			// Notification accepted; consume the body so the connection can be reused.
			await response.arrayBuffer().catch(() => undefined);
			return null;
		}

		const contentType = response.headers.get('content-type') ?? '';
		const body = await response.text();
		if (contentType.includes('text/event-stream')) {
			return parseSseResponse(body, message.id as number | undefined);
		}
		const parsed = JSON.parse(body) as JsonRpcResponse | JsonRpcResponse[];
		const single = Array.isArray(parsed) ? parsed.find((m) => m.id === message.id) : parsed;
		if (!single) throw new McpError(null, 'MCP response did not match the request id');
		if (single.error) {
			throw new McpError(
				null,
				`MCP error ${single.error.code ?? ''}: ${single.error.message ?? 'unknown'}`
			);
		}
		return single;
	}
}

/** Extract the tool payload: structuredContent when present, else the first text content block. */
function unwrapResult(result: Json): unknown {
	if (result.structuredContent !== undefined) return result.structuredContent;
	const content = result.content;
	if (Array.isArray(content)) {
		const text = content.find((c) => c && typeof c === 'object' && (c as Json).type === 'text');
		if (text) {
			const raw = String((text as Json).text ?? '');
			try {
				return JSON.parse(raw);
			} catch {
				return raw;
			}
		}
		return content;
	}
	return result;
}

function toolText(result: Json): string {
	const content = result.content;
	if (Array.isArray(content)) {
		return content
			.map((c) => ((c as Json)?.type === 'text' ? String((c as Json).text) : ''))
			.filter(Boolean)
			.join(' ');
	}
	return 'unknown error';
}

/** Parse an SSE response body into the JSON-RPC message with the given id. */
export function parseSseResponse(body: string, id: number | undefined): JsonRpcResponse | null {
	for (const line of body.split('\n')) {
		if (!line.startsWith('data:')) continue;
		const data = line.slice(5).trim();
		if (!data) continue;
		let message: JsonRpcResponse;
		try {
			message = JSON.parse(data) as JsonRpcResponse;
		} catch {
			continue;
		}
		if (id === undefined || message.id === id) {
			if (message.error) {
				throw new McpError(
					null,
					`MCP error ${message.error.code ?? ''}: ${message.error.message ?? 'unknown'}`
				);
			}
			return message;
		}
	}
	return null;
}
