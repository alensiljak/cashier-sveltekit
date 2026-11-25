// @vitest-environment node
/*
    Tests for the connection operations (connection.ts): syncing a session,
    revoking, and disconnecting, with an in-memory device store.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ settings: new Map<string, unknown>() }));

vi.mock('#lib/settings', () => ({
	deviceSettings: {
		get: vi.fn(async (key: string) => structuredClone(store.settings.get(key) ?? null)),
		set: vi.fn(async (key: string, value: unknown) => void store.settings.set(key, value)),
		delete: vi.fn(async (key: string) => void store.settings.delete(key))
	},
	DeviceSettingKeys: {
		enableBankingCredentials: 'credentials',
		enableBankingSessions: 'sessions',
		enableBankingPendingAuth: 'pending',
		enableBankingBalances: 'balances'
	}
}));

import { EbError } from '#lib/importers/enablebanking/api';
import { loadBalanceCache, saveBalanceCache } from '#lib/importers/enablebanking/balances';
import {
	disconnectEnableBanking,
	revokeSession,
	syncSession
} from '#lib/importers/enablebanking/connection';
import { addSession, loadSessions } from '#lib/importers/enablebanking/sessions';

const session = (id: string) => ({
	sessionId: id,
	aspsp: { name: `Bank ${id}`, country: 'DE' },
	createdAt: '2026-11-25T09:00:00.000Z',
	accounts: [{ uid: `acc-${id}`, name: 'Main' }]
});

const failingFor = (id: string, status: number) => ({
	deleteSession: vi.fn(async (sessionId: string) => {
		if (sessionId === id) throw new EbError(status, null, `HTTP ${status}`);
	})
});

const ids = async () => (await loadSessions()).map((s) => s.sessionId);

beforeEach(async () => {
	store.settings.clear();
	store.settings.set('credentials', { appId: 'a', privateKeyPem: 'p' });
	await addSession(session('s1'));
	await addSession(session('s2'));
	await saveBalanceCache({
		's1:acc-s1': { balances: [], fetchedAt: '2026-11-25T09:00:00.000Z' },
		's2:acc-s2': { balances: [], fetchedAt: '2026-11-25T09:00:00.000Z' }
	});
});

describe('syncSession', () => {
	it('stores the live status and consent date, keeping account details', async () => {
		const sessions = await syncSession(
			{
				getSession: async () => ({
					status: 'AUTHORIZED',
					access: { valid_until: '2027-01-01T00:00:00Z' },
					accounts: ['acc-s1']
				})
			},
			's1'
		);
		expect(sessions[0]).toMatchObject({
			status: 'AUTHORIZED',
			validUntil: '2027-01-01T00:00:00Z',
			accounts: [{ uid: 'acc-s1', name: 'Main' }]
		});
	});
});

describe('revokeSession', () => {
	it('removes the session and its cached balances', async () => {
		await revokeSession(failingFor('none', 500), 's1');
		expect(await ids()).toEqual(['s2']);
		expect(Object.keys(await loadBalanceCache())).toEqual(['s2:acc-s2']);
	});

	it('keeps the session when revoking fails', async () => {
		await expect(revokeSession(failingFor('s1', 500), 's1')).rejects.toThrow('HTTP 500');
		expect(await ids()).toEqual(['s1', 's2']);
	});

	it('treats a 404 as already revoked', async () => {
		await revokeSession(failingFor('s1', 404), 's1');
		expect(await ids()).toEqual(['s2']);
	});
});

describe('disconnectEnableBanking', () => {
	it('keeps the credentials and the sessions that could not be revoked', async () => {
		const failures = await disconnectEnableBanking(failingFor('s2', 500));
		expect(failures.map((f) => f.session.sessionId)).toEqual(['s2']);
		expect(await ids()).toEqual(['s2']);
		expect(store.settings.has('credentials')).toBe(true);
	});

	it('deletes everything once all consents are revoked', async () => {
		expect(await disconnectEnableBanking(failingFor('none', 500))).toEqual([]);
		expect([...store.settings.keys()]).toEqual([]);
	});

	it('clears the device data when there is no client to revoke with', async () => {
		expect(await disconnectEnableBanking(null)).toEqual([]);
		expect([...store.settings.keys()]).toEqual([]);
	});
});
