// @vitest-environment node
/*
    Tests for the Enable Banking session store (src/lib/importers/enablebanking/sessions.ts):
    device-only storage of connected sessions and the pending-authorization records that
    survive the redirect to the bank and back.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ settings: new Map<string, unknown>() }));

vi.mock('#lib/settings', () => ({
	deviceSettings: {
		get: vi.fn(async (key: string) => store.settings.get(key) ?? null),
		set: vi.fn(async (key: string, value: unknown) => void store.settings.set(key, value)),
		delete: vi.fn(async (key: string) => void store.settings.delete(key))
	},
	DeviceSettingKeys: {
		enableBankingSessions: 'importer.enablebanking.sessions',
		enableBankingPendingAuth: 'importer.enablebanking.pendingAuth'
	}
}));

import {
	addSession,
	clearPendingAuth,
	clearSessions,
	findPendingAuth,
	loadSessions,
	mergeSessionAccounts,
	normalizeSessionAccounts,
	removeSession,
	savePendingAuth,
	sessionStatus,
	updateSession,
	PENDING_AUTH_TTL_MS,
	type StoredSession
} from '#lib/importers/enablebanking/sessions';

function session(id: string): StoredSession {
	return {
		sessionId: id,
		aspsp: { name: 'Mock ASPSP', country: 'DE' },
		createdAt: '2026-11-25T09:00:00.000Z',
		validUntil: '2027-02-23T09:00:00.000Z',
		accounts: [{ uid: `acc-${id}` }]
	};
}

beforeEach(() => {
	store.settings.clear();
});

describe('stored sessions (device-only settings)', () => {
	it('loads an empty list when nothing is stored', async () => {
		expect(await loadSessions()).toEqual([]);
	});

	it('addSession appends and replaces by session id', async () => {
		await addSession(session('s1'));
		await addSession(session('s2'));
		await addSession({ ...session('s1'), accounts: [{ uid: 'acc-new' }] });
		const sessions = await loadSessions();
		expect(sessions.map((s) => s.sessionId).sort()).toEqual(['s1', 's2']);
		expect(sessions.find((s) => s.sessionId === 's1')?.accounts[0].uid).toBe('acc-new');
	});

	it('removeSession deletes one and clearSessions wipes all', async () => {
		await addSession(session('s1'));
		await addSession(session('s2'));
		await removeSession('s1');
		expect((await loadSessions()).map((s) => s.sessionId)).toEqual(['s2']);
		await clearSessions();
		expect(await loadSessions()).toEqual([]);
	});
});

describe('session account lists (POST /sessions vs GET /sessions/{id})', () => {
	const rich = [
		{ uid: 'u1', name: 'Main', account_id: { iban: 'DE00 1' } },
		{ uid: 'u2', name: 'Savings' }
	];

	it('normalizes a string list (GET /sessions/{id}) to account objects', () => {
		expect(normalizeSessionAccounts(['u1', 'u2'])).toEqual([{ uid: 'u1' }, { uid: 'u2' }]);
		expect(normalizeSessionAccounts([{ uid: 'u1', name: 'Main' }])).toEqual([
			{ uid: 'u1', name: 'Main' }
		]);
		expect(normalizeSessionAccounts(undefined)).toEqual([]);
		expect(normalizeSessionAccounts(['', 42 as unknown as string])).toEqual([]);
	});

	it('merge keeps the rich stored account for known uids and keeps unknown uids as { uid }', () => {
		// GET /sessions/{id} returns ids only; POST /sessions details must not be lost.
		expect(mergeSessionAccounts(rich, ['u1', 'u2'])).toEqual(rich);
		expect(mergeSessionAccounts(rich, ['u2', 'u3'])).toEqual([rich[1], { uid: 'u3' }]);
		expect(mergeSessionAccounts(rich, [])).toEqual(rich);
		expect(mergeSessionAccounts(rich, undefined)).toEqual(rich);
	});
});

describe('stored session upkeep', () => {
	it('repairs accounts stored as ID strings, dropping repeats', async () => {
		store.settings.set('importer.enablebanking.sessions', [
			{ ...session('s1'), accounts: ['u1', 'u2', 'u1'] }
		]);
		expect((await loadSessions())[0].accounts).toEqual([{ uid: 'u1' }, { uid: 'u2' }]);
	});

	it('keeps the order when a session is replaced or updated', async () => {
		await addSession(session('s1'));
		await addSession(session('s2'));
		await addSession(session('s1'));
		await updateSession('s1', (s) => ({ ...s, status: 'AUTHORIZED' }));
		expect((await loadSessions()).map((s) => s.sessionId)).toEqual(['s1', 's2']);
	});

	it('does not lose parallel updates or re-add a removed session', async () => {
		await addSession(session('s1'));
		await addSession(session('s2'));
		await Promise.all(
			['s1', 's2', 'gone'].map((id) => updateSession(id, (s) => ({ ...s, status: id })))
		);
		expect((await loadSessions()).map((s) => s.status)).toEqual(['s1', 's2']);
	});

	it('fills in identification hashes from accounts_data', () => {
		expect(
			mergeSessionAccounts([{ uid: 'u1' }], ['u1'], [{ uid: 'u1', identification_hash: 'h1' }])
		).toEqual([{ uid: 'u1', identification_hash: 'h1' }]);
	});

	it('reports a session past its consent date as expired', () => {
		const before = Date.parse('2026-12-01T00:00:00Z');
		const after = Date.parse('2027-03-01T00:00:00Z');
		const authorized = { ...session('s1'), status: 'AUTHORIZED' };
		expect(sessionStatus(authorized, before)).toBe('AUTHORIZED');
		expect(sessionStatus(authorized, after)).toBe('EXPIRED');
		expect(sessionStatus({ ...authorized, status: 'REVOKED' }, after)).toBe('REVOKED');
	});
});

describe('pending authorization (survives the redirect round trip)', () => {
	const now = Date.parse('2026-11-25T09:00:00.000Z');
	const pending = (state: string) => ({
		state,
		aspsp: { name: 'Mock ASPSP', country: 'DE' },
		validUntil: '2027-02-23T09:00:00.000Z',
		createdAt: '2026-11-25T09:00:00.000Z'
	});

	it('is found and cleared by its state, leaving the others', async () => {
		await savePendingAuth(pending('a'), now);
		await savePendingAuth(pending('b'), now);
		expect(await findPendingAuth('a', now)).toEqual(pending('a'));
		expect(await findPendingAuth('unknown', now)).toBeNull();
		expect(await findPendingAuth(null, now)).toBeNull();
		await clearPendingAuth('a', now);
		expect(await findPendingAuth('a', now)).toBeNull();
		expect(await findPendingAuth('b', now)).toEqual(pending('b'));
	});

	it('expires', async () => {
		await savePendingAuth(pending('a'), now);
		expect(await findPendingAuth('a', now + PENDING_AUTH_TTL_MS)).toBeNull();
	});

	it('ignores corrupt records', async () => {
		store.settings.set('importer.enablebanking.pendingAuth', 'garbage');
		expect(await findPendingAuth('a', now)).toBeNull();
	});
});
