import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import type { McpTokenSource } from './mcp';
import {
	authorizeUrl,
	callbackUrl,
	createPkce,
	createState,
	exchangeCode,
	OAuthError,
	refreshTokens,
	registerClient,
	type TokenResponse
} from './oauth';

/**
 * OAuth credentials for the Scalable MCP endpoint. Stored in device-only
 * settings — a credential is never exported with backups or synced.
 */
export interface StoredAuth {
	clientId: string;
	redirectUri: string;
	accessToken: string;
	refreshToken?: string;
	/** Epoch ms when the access token expires. */
	expiresAt: number;
}

/** In-flight authorization (survives the full-page redirect to Scalable's login). */
interface PendingAuth {
	state: string;
	verifier: string;
	clientId: string;
	redirectUri: string;
}

const PENDING_KEY = 'cashier.scalable.oauth.pending';

export { OAuthError };

export async function loadAuth(): Promise<StoredAuth | null> {
	return deviceSettings.get<StoredAuth>(DeviceSettingKeys.scalableOAuth);
}

export async function saveAuth(auth: StoredAuth): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.scalableOAuth, auth);
}

export async function clearAuth(): Promise<void> {
	await deviceSettings.delete(DeviceSettingKeys.scalableOAuth);
	try {
		localStorage.removeItem(PENDING_KEY);
	} catch {
		// Storage unavailable: the pending flow just won't complete.
	}
}

function fromTokenResponse(
	clientId: string,
	redirectUri: string,
	tokens: TokenResponse
): StoredAuth {
	return {
		clientId,
		redirectUri,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000
	};
}

/**
 * Start the browser login: register this origin as an OAuth client (once),
 * stash the PKCE verifier + state, and return the Scalable URL to open.
 * The caller navigates to it; the callback route finishes the flow.
 */
export async function startAuthorization(origin: string = location.origin): Promise<string> {
	const redirectUri = callbackUrl(origin);
	const existing = await loadAuth();
	let clientId = existing?.clientId;
	// The client registration is bound to its redirect URI; re-register on a new origin.
	if (!clientId || existing?.redirectUri !== redirectUri) {
		clientId = await registerClient(redirectUri);
	}
	const { verifier, challenge } = await createPkce();
	const state = createState();
	const pending: PendingAuth = { state, verifier, clientId, redirectUri };
	localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
	return authorizeUrl({ clientId, redirectUri, state, challenge });
}

/** Finish the browser login on the callback route: verify state, exchange the code. */
export async function completeAuthorization(searchParams: {
	get(name: string): string | null;
}): Promise<void> {
	const providerError = searchParams.get('error');
	if (providerError) {
		throw new OAuthError(`Scalable Capital did not grant access: ${providerError}`);
	}
	const code = searchParams.get('code');
	const state = searchParams.get('state');
	let pending: PendingAuth | null = null;
	try {
		pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as PendingAuth | null;
	} catch {
		pending = null;
	}
	if (!pending || !code || !state || state !== pending.state) {
		throw new OAuthError(
			'The login callback did not match the pending connection (state mismatch). Start the connection again.'
		);
	}
	const tokens = await exchangeCode(pending.clientId, pending.redirectUri, code, pending.verifier);
	await saveAuth(fromTokenResponse(pending.clientId, pending.redirectUri, tokens));
	try {
		localStorage.removeItem(PENDING_KEY);
	} catch {
		// Storage unavailable: the pending entry is harmless.
	}
}

/** Token source for McpClient: returns a valid access token, refreshing it when expired. */
export class ScalableAuth implements McpTokenSource {
	async getToken(): Promise<string> {
		const auth = await loadAuth();
		if (!auth)
			throw new OAuthError(
				'Not connected to Scalable Capital yet — use Connect on the Importers page.'
			);
		if (auth.expiresAt - 60_000 > Date.now()) return auth.accessToken;
		const refreshed = await this.refresh();
		if (!refreshed) {
			throw new OAuthError('The Scalable session expired — connect again on the Importers page.');
		}
		return refreshed;
	}

	/** Refresh the access token; returns the new token, or null when re-login is needed. */
	async refresh(): Promise<string | null> {
		const auth = await loadAuth();
		if (!auth?.refreshToken) return null;
		try {
			const tokens = await refreshTokens(auth.clientId, auth.refreshToken);
			const next: StoredAuth = {
				...auth,
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token ?? auth.refreshToken,
				expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000
			};
			await saveAuth(next);
			return next.accessToken;
		} catch {
			return null;
		}
	}
}
