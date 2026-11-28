import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { EB_JWT_DEFAULT_TTL_SECONDS, isPkcs1Pem, isPkcs8Pem, signEnableBankingJwt } from './jwt';

/**
 * Enable Banking app credentials: the application ID (the JWT `kid`) and the
 * RSA private key PEM downloaded when the app was registered in the Enable
 * Banking Control Panel. Every API call needs a JWT signed with that key, so
 * the PWA signs them itself with WebCrypto (jwt.ts).
 *
 * The credentials are stored in device-only settings: a private key is never
 * synced between devices, and a backup holds it only in its encrypted
 * credentials group (same as the Scalable tokens and the Mistral API key).
 * Enable Banking's docs advise
 * keeping the key out of client apps; for a personal app on the user's own
 * device, device-only storage is the same trust level as the other
 * credentials, and the form says so.
 */
export class EbAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EbAuthError';
	}
}

export interface StoredCredentials {
	/** Application ID (UUID) from Control Panel → API applications; the JWT `kid`. */
	appId: string;
	/** The `<app-id>.pem` private key file, as text (PKCS#8 or PKCS#1). */
	privateKeyPem: string;
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
	return deviceSettings.get<StoredCredentials>(DeviceSettingKeys.enableBankingCredentials);
}

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.enableBankingCredentials, credentials);
}

export async function clearCredentials(): Promise<void> {
	await deviceSettings.delete(DeviceSettingKeys.enableBankingCredentials);
}

/**
 * Validate the app ID and PEM pasted into the config form.
 * Accepts a PKCS#8 ("BEGIN PRIVATE KEY") or PKCS#1 ("BEGIN RSA PRIVATE KEY") block.
 */
export function validateCredentials(appId: string, privateKeyPem: string): StoredCredentials {
	const id = appId.trim();
	if (!/^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(id)) {
		throw new EbAuthError(
			'The application ID does not look like a UUID — copy it from Enable Banking Control Panel → API applications.'
		);
	}
	const pem = privateKeyPem.trim();
	if (!isPkcs8Pem(pem) && !isPkcs1Pem(pem)) {
		throw new EbAuthError(
			'Paste the whole .pem file the Control Panel downloaded at registration (it starts with "-----BEGIN PRIVATE KEY-----").'
		);
	}
	return { appId: id, privateKeyPem: pem };
}

/** Validate and store device-only. Returns the stored record. */
export async function saveCredentialsInput(
	appId: string,
	privateKeyPem: string
): Promise<StoredCredentials> {
	const credentials = validateCredentials(appId, privateKeyPem);
	await saveCredentials(credentials);
	return credentials;
}

/**
 * Signs API JWTs with the stored credentials, caching the token until shortly
 * before it expires (signing an RSA JWT per request would work too, but the
 * cache keeps the proxy traffic light).
 */
export class EnableBankingTokenSource {
	private cached: { token: string; expiresAt: number } | null = null;

	constructor(private readonly credentials: StoredCredentials) {}

	async getToken(): Promise<string> {
		const now = Date.now();
		if (this.cached && this.cached.expiresAt - 60_000 > now) return this.cached.token;
		const token = await signEnableBankingJwt(
			this.credentials.appId,
			this.credentials.privateKeyPem,
			{
				ttlSeconds: EB_JWT_DEFAULT_TTL_SECONDS,
				now
			}
		);
		this.cached = { token, expiresAt: now + EB_JWT_DEFAULT_TTL_SECONDS * 1000 };
		return token;
	}

	/** Test hook: drop the cached token. */
	resetCache(): void {
		this.cached = null;
	}
}
