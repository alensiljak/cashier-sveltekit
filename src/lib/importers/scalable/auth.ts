import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import type { McpTokenSource } from './mcp';
import { refreshTokens, TokenError, type TokenResponse } from './token';

/**
 * Scalable Capital credentials. A PWA cannot complete the OAuth login itself
 * (no localhost redirect), so the user runs `scripts/scalable_token.py` on
 * their computer and pastes the JSON it prints into the importer form. The
 * tokens are stored in device-only settings: a credential is never synced,
 * and a backup holds it only in its encrypted credentials group.
 */
export interface StoredAuth {
	/** Public OAuth client the localhost script registered (needed to refresh). */
	clientId: string;
	accessToken: string;
	refreshToken?: string;
	/** Epoch ms when the access token expires. */
	expiresAt: number;
}

/** The JSON shape printed by scripts/scalable_token.py. */
export interface PastedTokens {
	client_id: string;
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	/** Alternative to expires_in: epoch seconds or milliseconds. */
	expires_at?: number;
}

export { TokenError };

export async function loadAuth(): Promise<StoredAuth | null> {
	return deviceSettings.get<StoredAuth>(DeviceSettingKeys.scalableTokens);
}

export async function saveAuth(auth: StoredAuth): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.scalableTokens, auth);
}

export async function clearAuth(): Promise<void> {
	await deviceSettings.delete(DeviceSettingKeys.scalableTokens);
}

/**
 * Parse and validate the JSON printed by scripts/scalable_token.py.
 * Accepts `expires_in` (seconds from now) or `expires_at` (epoch s/ms).
 */
export function parsePastedTokens(text: string): StoredAuth {
	let data: PastedTokens;
	try {
		data = JSON.parse(text) as PastedTokens;
	} catch {
		throw new TokenError('That is not valid JSON — paste the whole JSON block the script printed.');
	}
	if (typeof data?.client_id !== 'string' || !data.client_id) {
		throw new TokenError('The JSON has no "client_id" — run scripts/scalable_token.py again.');
	}
	if (typeof data?.access_token !== 'string' || !data.access_token) {
		throw new TokenError('The JSON has no "access_token" — run scripts/scalable_token.py again.');
	}
	let expiresAt: number;
	if (typeof data.expires_at === 'number' && data.expires_at > 0) {
		expiresAt = data.expires_at > 1e12 ? data.expires_at : data.expires_at * 1000;
	} else {
		const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
		expiresAt = Date.now() + expiresIn * 1000;
	}
	return {
		clientId: data.client_id,
		accessToken: data.access_token,
		refreshToken:
			typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : undefined,
		expiresAt
	};
}

/** Validate pasted JSON and store it device-only. Returns the stored record. */
export async function savePastedTokens(text: string): Promise<StoredAuth> {
	const auth = parsePastedTokens(text);
	await saveAuth(auth);
	return auth;
}

/** Token source for McpClient: returns a valid access token, refreshing it when expired. */
export class ScalableAuth implements McpTokenSource {
	async getToken(): Promise<string> {
		const auth = await loadAuth();
		if (!auth) {
			throw new TokenError(
				'Not connected to Scalable Capital yet — run scripts/scalable_token.py on your computer and paste the tokens on the Importers page.'
			);
		}
		if (auth.expiresAt - 60_000 > Date.now()) return auth.accessToken;
		const refreshed = await this.refresh();
		if (!refreshed) {
			throw new TokenError(
				'The Scalable session expired — run scripts/scalable_token.py again and paste the new tokens on the Importers page.'
			);
		}
		return refreshed;
	}

	/** Refresh the access token; returns the new token, or null when re-login is needed. */
	async refresh(): Promise<string | null> {
		const auth = await loadAuth();
		if (!auth?.refreshToken) return null;
		try {
			const tokens: TokenResponse = await refreshTokens(auth.clientId, auth.refreshToken);
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
