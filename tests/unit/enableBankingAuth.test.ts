// @vitest-environment node
/*
    Tests for the Enable Banking credentials (src/lib/importers/enablebanking/auth.ts):
    validating the app ID + private key PEM pasted in the config form, storing them
    device-only, and the token source that signs a cached JWT per hour.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ settings: new Map<string, unknown>() }));

vi.mock('#lib/settings', () => ({
	deviceSettings: {
		get: vi.fn(async (key: string) => store.settings.get(key) ?? null),
		set: vi.fn(async (key: string, value: unknown) => void store.settings.set(key, value)),
		delete: vi.fn(async (key: string) => void store.settings.delete(key))
	},
	DeviceSettingKeys: { enableBankingCredentials: 'importer.enablebanking.credentials' }
}));

import {
	clearCredentials,
	EnableBankingTokenSource,
	EbAuthError,
	loadCredentials,
	saveCredentialsInput,
	validateCredentials
} from '#lib/importers/enablebanking/auth';
import { decodeJwt, EB_JWT_AUDIENCE, EB_JWT_ISSUER } from '#lib/importers/enablebanking/jwt';

const APP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

async function testPem(): Promise<string> {
	const pair = await crypto.subtle.generateKey(
		{
			name: 'RSASSA-PKCS1-v1_5',
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: 'SHA-256'
		},
		true,
		['sign', 'verify']
	);
	const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
	let binary = '';
	for (const b of der) binary += String.fromCharCode(b);
	return `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----\n`;
}

beforeEach(() => {
	store.settings.clear();
});

describe('validateCredentials', () => {
	it('accepts a UUID app id and a PKCS#8 PEM', async () => {
		const pem = await testPem();
		const credentials = validateCredentials(`  ${APP_ID}  `, pem);
		expect(credentials.appId).toBe(APP_ID);
		expect(credentials.privateKeyPem).toContain('BEGIN PRIVATE KEY');
	});

	it('accepts a PKCS#1 PEM', () => {
		const pkcs1 = '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----';
		expect(validateCredentials(APP_ID, pkcs1).privateKeyPem).toContain('RSA PRIVATE KEY');
	});

	it('rejects a malformed application id', async () => {
		const pem = await testPem();
		expect(() => validateCredentials('not-a-uuid', pem)).toThrow(EbAuthError);
		expect(() => validateCredentials('not-a-uuid', pem)).toThrow(/application ID/i);
	});

	it('rejects input that is not a private key PEM', async () => {
		expect(() => validateCredentials(APP_ID, 'hello')).toThrow(/\.pem/);
		expect(() =>
			validateCredentials(APP_ID, '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----')
		).toThrow(/PRIVATE KEY/);
	});
});

describe('storage (device-only settings)', () => {
	it('saveCredentialsInput validates, stores and loadCredentials reads back', async () => {
		const pem = await testPem();
		await saveCredentialsInput(APP_ID, pem);
		const loaded = await loadCredentials();
		expect(loaded?.appId).toBe(APP_ID);
		expect(store.settings.get('importer.enablebanking.credentials')).toBeTruthy();
	});

	it('clearCredentials removes the stored credentials', async () => {
		await saveCredentialsInput(APP_ID, await testPem());
		await clearCredentials();
		expect(await loadCredentials()).toBeNull();
	});

	it('saveCredentialsInput does not store invalid input', async () => {
		await expect(saveCredentialsInput('nope', 'nope')).rejects.toThrow(EbAuthError);
		expect(await loadCredentials()).toBeNull();
	});
});

describe('EnableBankingTokenSource', () => {
	it('signs a JWT with kid=app id and the fixed iss/aud, cached until near expiry', async () => {
		const pem = await testPem();
		const source = new EnableBankingTokenSource({ appId: APP_ID, privateKeyPem: pem });
		const token1 = await source.getToken();
		const token2 = await source.getToken();
		expect(token2).toBe(token1); // cached

		const { header, payload } = decodeJwt(token1);
		expect(header).toMatchObject({ alg: 'RS256', kid: APP_ID });
		expect(payload.iss).toBe(EB_JWT_ISSUER);
		expect(payload.aud).toBe(EB_JWT_AUDIENCE);
		expect((payload.exp as number) - (payload.iat as number)).toBe(3600);
	});
});
