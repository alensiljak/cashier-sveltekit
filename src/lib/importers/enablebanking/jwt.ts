/**
 * RS256 (RSASSA-PKCS1-v1_5 with SHA-256) JWT signing for the Enable Banking
 * API, using WebCrypto (docs/api/reference, "JWT format and signature").
 *
 * Enable Banking issues no API key and no token endpoint: every API request
 * carries a freshly signed JWT as `Authorization: Bearer <jwt>`:
 *
 *   header  { typ: "JWT", alg: "RS256", kid: <application id> }
 *   payload { iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp }
 *
 * The JWT is signed with the RSA private key whose certificate was uploaded
 * when the application was registered (the `<app-id>.pem` file the Control
 * Panel downloads). The key is stored device-only (see auth.ts); signing runs
 * in the browser via `crypto.subtle`, which speaks exactly RS256.
 *
 * The same host serves sandbox and production; the `kid` (application id)
 * decides which environment the call lands in.
 */

export class JwtError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'JwtError';
	}
}

/** Fixed claims of an Enable Banking API JWT. */
export const EB_JWT_ISSUER = 'enablebanking.com';
export const EB_JWT_AUDIENCE = 'api.enablebanking.com';
/** The API rejects tokens valid for longer than 24 h. */
export const EB_JWT_MAX_TTL_SECONDS = 86_400;
export const EB_JWT_DEFAULT_TTL_SECONDS = 3_600;

export function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlDecode(segment: string): Uint8Array {
	const base64 = segment.replaceAll('-', '+').replaceAll('_', '/');
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Strip the PEM armor and decode the body to DER bytes. */
export function pemToDer(pem: string): Uint8Array {
	const base64 = pem
		.replace(/-----BEGIN [^-]+-----/g, '')
		.replace(/-----END [^-]+-----/g, '')
		.replace(/\s+/g, '');
	if (!base64) throw new JwtError('The PEM block is empty');
	try {
		return base64UrlDecode(base64.replace(/=+$/, ''));
	} catch {
		throw new JwtError('The PEM body is not valid base64 — paste the whole .pem file');
	}
}

export function isPkcs8Pem(pem: string): boolean {
	return /-----BEGIN PRIVATE KEY-----/.test(pem);
}

export function isPkcs1Pem(pem: string): boolean {
	return /-----BEGIN RSA PRIVATE KEY-----/.test(pem);
}

/** DER length in the short or long form. */
function derLength(length: number): number[] {
	if (length < 0x80) return [length];
	const bytes: number[] = [];
	let rest = length;
	while (rest > 0) {
		bytes.unshift(rest & 0xff);
		rest >>= 8;
	}
	return [0x80 | bytes.length, ...bytes];
}

/**
 * Wrap a PKCS#1 ("RSA PRIVATE KEY") DER blob into PKCS#8 ("PRIVATE KEY"),
 * which is the only private-key format WebCrypto imports:
 * SEQUENCE { INTEGER 0, SEQUENCE { OID rsaEncryption, NULL }, OCTET STRING pkcs1 }.
 */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
	const version = [0x02, 0x01, 0x00];
	const algorithm = [
		0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
	];
	const octetString = [0x04, ...derLength(pkcs1.length), ...pkcs1];
	const content = [...version, ...algorithm, ...octetString];
	return new Uint8Array([0x30, ...derLength(content.length), ...content]);
}

const keyCache = new Map<string, CryptoKey>();

/** Import the app's private key (PKCS#8 or PKCS#1 PEM) as a signing CryptoKey. Cached per PEM. */
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
	const cached = keyCache.get(pem);
	if (cached) return cached;
	let der = pemToDer(pem);
	if (isPkcs1Pem(pem)) der = pkcs1ToPkcs8(der);
	else if (!isPkcs8Pem(pem)) {
		throw new JwtError(
			'The PEM must be a "PRIVATE KEY" (PKCS#8) or "RSA PRIVATE KEY" (PKCS#1) block — paste the whole .pem file downloaded at registration.'
		);
	}
	let key: CryptoKey;
	try {
		key = await crypto.subtle.importKey(
			'pkcs8',
			der as BufferSource,
			{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
			false,
			['sign']
		);
	} catch {
		throw new JwtError("The private key could not be read — is this the app's .pem file?");
	}
	keyCache.set(pem, key);
	return key;
}

export interface SignJwtOptions {
	/** Seconds until expiry; clamped to the 24 h maximum. Default 1 h. */
	ttlSeconds?: number;
	/** Clock override (ms), for tests. */
	now?: number;
}

/** Sign one Enable Banking API JWT (RS256). */
export async function signEnableBankingJwt(
	appId: string,
	privateKeyPem: string,
	options: SignJwtOptions = {}
): Promise<string> {
	if (!appId) throw new JwtError('The application ID is missing');
	const ttl = Math.max(
		1,
		Math.min(options.ttlSeconds ?? EB_JWT_DEFAULT_TTL_SECONDS, EB_JWT_MAX_TTL_SECONDS)
	);
	const iat = Math.floor((options.now ?? Date.now()) / 1000);
	const encoder = new TextEncoder();
	const header = base64UrlEncode(
		encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }))
	);
	const payload = base64UrlEncode(
		encoder.encode(
			JSON.stringify({ iss: EB_JWT_ISSUER, aud: EB_JWT_AUDIENCE, iat, exp: iat + ttl })
		)
	);
	const key = await importPrivateKey(privateKeyPem);
	const signature = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		key,
		encoder.encode(`${header}.${payload}`)
	);
	return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** Decode a JWT into its parts (no verification) — used by tests and debugging. */
export function decodeJwt(token: string): {
	header: Record<string, unknown>;
	payload: Record<string, unknown>;
	signature: Uint8Array;
	signingInput: string;
} {
	const parts = token.split('.');
	if (parts.length !== 3) throw new JwtError('Not a three-segment JWT');
	const decoder = new TextDecoder();
	return {
		header: JSON.parse(decoder.decode(base64UrlDecode(parts[0]))),
		payload: JSON.parse(decoder.decode(base64UrlDecode(parts[1]))),
		signature: base64UrlDecode(parts[2]),
		signingInput: `${parts[0]}.${parts[1]}`
	};
}
