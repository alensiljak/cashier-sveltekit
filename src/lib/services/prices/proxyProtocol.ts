/**
 * Wire protocol shared by the CORS proxy Worker (worker/proxy.ts) and the
 * client helper (proxyFetch.ts). Keep this file dependency-free so both
 * bundles can import it.
 */

export const PROXY_PATH = '/api/proxy';
export const PROXY_KEY_HEADER = 'X-Proxy-Key';
/**
 * Client → proxy: an upstream API key. The proxy forwards it as `X-API-KEY`,
 * and only to hosts listed in `UPSTREAM_KEY_HOSTS` (worker/proxy.ts).
 */
export const UPSTREAM_KEY_HEADER = 'X-Upstream-Key';
/**
 * Client → proxy: an upstream bearer token. The proxy forwards it as
 * `Authorization: Bearer <token>`, and only to hosts listed in
 * `UPSTREAM_BEARER_HOSTS` (worker/proxy.ts).
 */
export const UPSTREAM_BEARER_HEADER = 'X-Upstream-Authorization';
/**
 * Client → proxy: an MCP session id. The proxy forwards it as
 * `Mcp-Session-Id`, and only to hosts listed in `MCP_HOSTS`
 * (worker/proxy.ts). The proxy also passes an upstream `Mcp-Session-Id`
 * response header back to the client (see MCP_SESSION_HEADER).
 */
export const UPSTREAM_SESSION_HEADER = 'X-Upstream-Session-Id';
/** Upstream response header the proxy passes through for MCP hosts. */
export const MCP_SESSION_HEADER = 'Mcp-Session-Id';
