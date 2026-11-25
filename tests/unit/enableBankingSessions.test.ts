// @vitest-environment node
/*
    Tests for the Enable Banking session store (src/lib/importers/enablebanking/sessions.ts):
    device-only storage of connected sessions and the pending-authorization record that
    survives the redirect to the bank and back (sessionStorage, stubbed here).
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ settings: new Map<string, unknown>() }));

vi.mock('#lib/settings', () => ({
	deviceSettings: {
		get: vi.fn(async (key: string) => store.settings.get(key) ?? null),
		set: vi.fn(async (key: string, value: unknown) => void store.settings.set(key, value)),
		delete: vi.fn(async (key: string) => void store.settings.delete(key))
	},
	DeviceSettingKeys: { enableBankingSessions: 'importer.enablebanking.sessions' }
}));

import {
	addSession,
	clearPendingAuth,
	clearSessions,
	loadPendingAuth,
	loadSessions,
	removeSession,
	savePendingAuth,
	type StoredSession
} from '#lib/importers/enablebanking/sessions';

function memoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v),
		removeItem: (k) => void map.delete(k),
		clear: () => map.clear(),
		key: () => null,
		get length() {
			return map.size;
		}
	} as Storage;
}

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

describe('pending authorization (survives the redirect round trip)', () => {
	const pending = {
		state: 'state-1',
		aspsp: { name: 'Mock ASPSP', country: 'DE' },
		validUntil: '2027-02-23T09:00:00.000Z',
		redirectUrl: 'http://localhost:5173/importers/enable-banking/callback',
		psuType: 'personal'
	};

	it('round-trips through storage', () => {
		const storage = memoryStorage();
		savePendingAuth(pending, storage);
		expect(loadPendingAuth(storage)).toEqual(pending);
		clearPendingAuth(storage);
		expect(loadPendingAuth(storage)).toBeNull();
	});

	it('returns null for corrupt or incomplete records', () => {
		const storage = memoryStorage();
		storage.setItem('cashier.enablebanking.pending', '{not json');
		expect(loadPendingAuth(storage)).toBeNull();
		storage.setItem('cashier.enablebanking.pending', JSON.stringify({ state: 42 }));
		expect(loadPendingAuth(storage)).toBeNull();
	});
});
