/**
 * Wire protocol shared by the CORS proxy Worker (worker/proxy.ts) and the
 * client helper (proxyFetch.ts). Keep this file dependency-free so both
 * bundles can import it.
 */

export const PROXY_PATH = '/api/proxy';
export const PROXY_KEY_HEADER = 'X-Proxy-Key';
