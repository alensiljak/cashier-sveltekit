import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import type { EbSessionAccount } from './api';

/**
 * Sessions (bank consents) created on this device. A session is the Enable
 * Banking reference that unlocks account data; it is only usable together
 * with this device's app credentials, so it lives in device-only settings
 * too — never exported or synced.
 */
export interface StoredSession {
	sessionId: string;
	aspsp: { name: string; country: string };
	psuIdHash?: string;
	authorizationId?: string;
	/** ISO timestamp of when the consent completed. */
	createdAt: string;
	/** ISO timestamp the consent was requested to stay valid until. */
	validUntil?: string;
	/** Accounts as returned by POST /sessions (shown only once by the API). */
	accounts: EbSessionAccount[];
}

export async function loadSessions(): Promise<StoredSession[]> {
	return (await deviceSettings.get<StoredSession[]>(DeviceSettingKeys.enableBankingSessions)) ?? [];
}

export async function saveSessions(sessions: StoredSession[]): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.enableBankingSessions, sessions);
}

/** Add or replace (by session id). Returns the new list. */
export async function addSession(session: StoredSession): Promise<StoredSession[]> {
	const sessions = (await loadSessions()).filter((s) => s.sessionId !== session.sessionId);
	sessions.push(session);
	await saveSessions(sessions);
	return sessions;
}

/** Remove one session locally. Returns the new list. */
export async function removeSession(sessionId: string): Promise<StoredSession[]> {
	const sessions = (await loadSessions()).filter((s) => s.sessionId !== sessionId);
	await saveSessions(sessions);
	return sessions;
}

export async function clearSessions(): Promise<void> {
	await deviceSettings.delete(DeviceSettingKeys.enableBankingSessions);
}

/**
 * Normalize the `accounts` field of GET /sessions/{id}, which is a list of
 * account-ID strings, to account objects ({ uid }). Object entries pass through.
 */
export function normalizeSessionAccounts(accounts: unknown): EbSessionAccount[] {
	if (!Array.isArray(accounts)) return [];
	return accounts
		.map((a) => (typeof a === 'string' ? { uid: a } : (a as EbSessionAccount)))
		.filter((a) => typeof a?.uid === 'string' && a.uid.length > 0);
}

/**
 * Merge the id-only account list from GET /sessions/{id} with the rich accounts
 * stored from POST /sessions (which shows details only once): stored accounts
 * win for known uids, unknown uids are kept as { uid }.
 */
export function mergeSessionAccounts(
	stored: EbSessionAccount[],
	live: unknown
): EbSessionAccount[] {
	const liveAccounts = normalizeSessionAccounts(live);
	if (!liveAccounts.length) return stored;
	const storedByUid = new Map(stored.map((a) => [a.uid, a]));
	return liveAccounts.map((a) => storedByUid.get(a.uid) ?? a);
}

/**
 * The authorization in progress while the browser is away at the bank:
 * started by POST /auth, completed by the callback route. Kept in
 * sessionStorage, which survives the full-page redirect to the bank and back
 * (same tab) but not a new tab.
 */
export interface PendingAuth {
	state: string;
	aspsp: { name: string; country: string };
	/** ISO timestamp requested as access.valid_until. */
	validUntil: string;
	redirectUrl: string;
	psuType: string;
}

const PENDING_KEY = 'cashier.enablebanking.pending';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike {
	return sessionStorage;
}

export function savePendingAuth(
	pending: PendingAuth,
	storage: StorageLike = defaultStorage()
): void {
	storage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function loadPendingAuth(storage: StorageLike = defaultStorage()): PendingAuth | null {
	try {
		const raw = storage.getItem(PENDING_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PendingAuth;
		if (typeof parsed?.state !== 'string' || typeof parsed?.redirectUrl !== 'string') return null;
		return parsed;
	} catch {
		return null;
	}
}

export function clearPendingAuth(storage: StorageLike = defaultStorage()): void {
	storage.removeItem(PENDING_KEY);
}
