// @vitest-environment node
/*
    Tests for the Enable Banking JWT signer (src/lib/importers/enablebanking/jwt.ts):
    RS256 signing with WebCrypto against a real generated key pair, PEM handling
    (PKCS#8 and PKCS#1), claim shape, and TTL clamping — no network.
*/
import { describe, expect, it } from 'vitest';
import {
	base64UrlEncode,
	decodeJwt,
	EB_JWT_AUDIENCE,
	EB_JWT_ISSUER,
	EB_JWT_MAX_TTL_SECONDS,
	isPkcs1Pem,
	isPkcs8Pem,
	JwtError,
	pemToDer,
	pkcs1ToPkcs8,
	signEnableBankingJwt
} from '#lib/importers/enablebanking/jwt';

const APP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function toPem(label: string, der: ArrayBuffer): string {
	let binary = '';
	const bytes = new Uint8Array(der);
	for (const b of bytes) binary += String.fromCharCode(b);
	return `-----BEGIN ${label}-----\n${btoa(binary)}\n-----END ${label}-----\n`;
}

async function generateKeyPair() {
	return crypto.subtle.generateKey(
		{
			name: 'RSASSA-PKCS1-v1_5',
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: 'SHA-256'
		},
		true,
		['sign', 'verify']
	);
}

describe('PEM handling', () => {
	it('decodes a PKCS#8 PEM body to DER bytes', async () => {
		const pair = await generateKeyPair();
		const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
		const pem = toPem('PRIVATE KEY', der);
		expect(isPkcs8Pem(pem)).toBe(true);
		expect(isPkcs1Pem(pem)).toBe(false);
		expect([...pemToDer(pem)]).toEqual([...new Uint8Array(der)]);
	});

	it('wraps a PKCS#1 key into PKCS#8 so WebCrypto accepts it', async () => {
		const pair = await generateKeyPair();
		const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
		// PKCS#8 layout: 30 len | 02 01 00 | 30 0d <oid+null> | 04 len <pkcs1>
		// Fixed prefix length: 2 (header, long form assumed) computed dynamically below.
		let offset = 0;
		expect(pkcs8[offset++]).toBe(0x30);
		const readLen = (): number => {
			const first = pkcs8[offset++];
			if (first < 0x80) return first;
			const n = first & 0x7f;
			let length = 0;
			for (let i = 0; i < n; i++) length = (length << 8) | pkcs8[offset++];
			return length;
		};
		readLen(); // outer sequence
		offset += 3; // 02 01 00
		expect(pkcs8[offset++]).toBe(0x30);
		offset += 1 + readLen(); // algorithm identifier content
		expect(pkcs8[offset++]).toBe(0x04);
		const pkcs1Length = readLen();
		const pkcs1 = pkcs8.slice(offset, offset + pkcs1Length);

		const rewrapped = pkcs1ToPkcs8(pkcs1);
		expect([...rewrapped]).toEqual([...pkcs8]);

		const pkcs1Pem = toPem('RSA PRIVATE KEY', pkcs1.buffer as ArrayBuffer);
		expect(isPkcs1Pem(pkcs1Pem)).toBe(true);
		// And the wrapped form must import and sign with the same key.
		const token = await signEnableBankingJwt(APP_ID, pkcs1Pem, { now: 1_800_000_000_000 });
		const { signature, signingInput } = decodeJwt(token);
		const valid = await crypto.subtle.verify(
			'RSASSA-PKCS1-v1_5',
			pair.publicKey,
			signature as BufferSource,
			new TextEncoder().encode(signingInput)
		);
		expect(valid).toBe(true);
	});

	it('rejects PEM bodies that are not base64', () => {
		expect(() =>
			pemToDer('-----BEGIN PRIVATE KEY-----\n!!!not-base64!!!\n-----END PRIVATE KEY-----')
		).toThrow(JwtError);
	});
});

describe('signEnableBankingJwt', () => {
	it('produces a verifiable RS256 JWT with the Enable Banking claims', async () => {
		const pair = await generateKeyPair();
		const pem = toPem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey));
		const now = 1_800_000_000_000; // fixed clock
		const token = await signEnableBankingJwt(APP_ID, pem, { now });

		const { header, payload, signature, signingInput } = decodeJwt(token);
		expect(header).toEqual({ typ: 'JWT', alg: 'RS256', kid: APP_ID });
		expect(payload.iss).toBe(EB_JWT_ISSUER);
		expect(payload.aud).toBe(EB_JWT_AUDIENCE);
		expect(payload.iat).toBe(Math.floor(now / 1000));
		expect(payload.exp).toBe(Math.floor(now / 1000) + 3600);

		const valid = await crypto.subtle.verify(
			'RSASSA-PKCS1-v1_5',
			pair.publicKey,
			signature as BufferSource,
			new TextEncoder().encode(signingInput)
		);
		expect(valid).toBe(true);
	});

	it('clamps the TTL to the 24 h maximum', async () => {
		const pair = await generateKeyPair();
		const pem = toPem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey));
		const now = 1_800_000_000_000;
		const token = await signEnableBankingJwt(APP_ID, pem, { now, ttlSeconds: 10 * 86_400 });
		const { exp, iat } = decodeJwt(token).payload;
		expect((exp as number) - (iat as number)).toBe(EB_JWT_MAX_TTL_SECONDS);
	});

	it('rejects an empty application id', async () => {
		await expect(signEnableBankingJwt('', 'whatever')).rejects.toThrow(JwtError);
	});

	it('rejects a PEM that is neither PKCS#8 nor PKCS#1', async () => {
		await expect(
			signEnableBankingJwt(APP_ID, '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----')
		).rejects.toThrow(/PRIVATE KEY/);
	});
});

describe('base64UrlEncode', () => {
	it('encodes without padding and with the URL-safe alphabet', () => {
		expect(base64UrlEncode(new Uint8Array([251, 255, 190]))).toBe('-_--');
		expect(base64UrlEncode(new Uint8Array([104, 105]))).toBe('aGk');
	});
});
