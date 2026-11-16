/**
 * Cloudflare Worker entry point.
 *
 * `/api/proxy` is handled here (CORS proxy for price sources); every other
 * request is served from the static SvelteKit build through the `ASSETS`
 * binding (see wrangler.jsonc).
 */

import { handleProxyRequest, isProxyRequest } from './proxy';

interface Env {
	ASSETS: {
		fetch(request: Request): Promise<Response>;
	};
	/** Shared key required on `/api/proxy`; set with `wrangler secret put PROXY_KEY`. */
	PROXY_KEY?: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (isProxyRequest(request)) {
			return handleProxyRequest(request, { requiredKey: env.PROXY_KEY, requireKey: true });
		}
		return env.ASSETS.fetch(request);
	}
};
