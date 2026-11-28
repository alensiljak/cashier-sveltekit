import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import type { EbSession, EbSessionAccount } from './api';

/**
 * Sessions (bank consents) created on this device. A session is the Enable
 * Banking reference that unlocks account data; it is only usable together
 * with this device's app credentials, so it lives in device-only settings
 * too. Never synced; a backup holds them only encrypted, with the credentials.
 */
export interface StoredSession {
	sessionId: string;
	aspsp: { name: string; country: string };
	psuIdHash?: string;
	authorizationId?: string;
	/** ISO timestamp of when the consent completed. */
	createdAt: string;
	/** ISO timestamp the consent stays valid until. */
	validUntil?: string;
	/** Session status as of the last check. */
	status?: string;
	/** The bank's `required_psu_headers`, from the time of connecting. */
	requiredPsuHeaders?: string[];
	/** Accounts as returned by POST /sessions (shown only once by the API). */
	accounts: EbSessionAccount[];
}

let writeQueue: Promise<unknown> = Promise.resolve();

/** Run read-modify-write cycles one at a time, so parallel updates are not lost. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
	const result = writeQueue.then(task);
	writeQueue = result.catch(() => {});
	return result;
}

export async function loadSessions(): Promise<StoredSession[]> {
	const stored =
		(await deviceSettings.get<StoredSession[]>(DeviceSettingKeys.enableBankingSessions)) ?? [];
	// An earlier version stored the ID strings of GET /sessions/{id} as accounts.
	return stored.map((s) => ({ ...s, accounts: normalizeSessionAccounts(s.accounts) }));
}

export async function saveSessions(sessions: StoredSession[]): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.enableBankingSessions, sessions);
}

/** Add, or replace in place (by session id). Returns the new list. */
export function addSession(session: StoredSession): Promise<StoredSession[]> {
	return serialized(async () => {
		const sessions = await loadSessions();
		const index = sessions.findIndex((s) => s.sessionId === session.sessionId);
		if (index < 0) sessions.push(session);
		else sessions[index] = session;
		await saveSessions(sessions);
		return sessions;
	});
}

/**
 * Change one stored session in place. Writes only when something differs, and
 * never re-adds a session that has been removed. Returns the list.
 */
export function updateSession(
	sessionId: string,
	update: (session: StoredSession) => StoredSession
): Promise<StoredSession[]> {
	return serialized(async () => {
		const sessions = await loadSessions();
		const index = sessions.findIndex((s) => s.sessionId === sessionId);
		if (index < 0) return sessions;
		const next = update(sessions[index]);
		if (JSON.stringify(next) !== JSON.stringify(sessions[index])) {
			sessions[index] = next;
			await saveSessions(sessions);
		}
		return sessions;
	});
}

/** Remove one session locally. Returns the new list. */
export function removeSession(sessionId: string): Promise<StoredSession[]> {
	return serialized(async () => {
		const sessions = (await loadSessions()).filter((s) => s.sessionId !== sessionId);
		await saveSessions(sessions);
		return sessions;
	});
}

export function clearSessions(): Promise<void> {
	return serialized(async () => {
		await deviceSettings.delete(DeviceSettingKeys.enableBankingSessions);
	});
}

/**
 * Normalize an account list to account objects ({ uid }), one per uid. GET
 * /sessions/{id} returns ID strings; object entries pass through.
 */
export function normalizeSessionAccounts(accounts: unknown): EbSessionAccount[] {
	if (!Array.isArray(accounts)) return [];
	const byUid = new Map<string, EbSessionAccount>();
	for (const entry of accounts) {
		const account = typeof entry === 'string' ? { uid: entry } : (entry as EbSessionAccount);
		if (typeof account?.uid !== 'string' || !account.uid) continue;
		byUid.set(account.uid, { ...byUid.get(account.uid), ...account });
	}
	return [...byUid.values()];
}

/**
 * Merge the id-only account list from GET /sessions/{id} with the rich accounts
 * stored from POST /sessions (which shows details only once): stored accounts
 * win for known uids, unknown uids are kept as { uid }. `accountsData` fills in
 * missing identification hashes.
 */
export function mergeSessionAccounts(
	stored: EbSessionAccount[],
	live: unknown,
	accountsData: EbSession['accounts_data'] = []
): EbSessionAccount[] {
	const liveAccounts = normalizeSessionAccounts(live);
	const accounts = liveAccounts.length
		? liveAccounts.map((a) => stored.find((s) => s.uid === a.uid) ?? a)
		: stored;
	return accounts.map((account) => {
		const hash = accountsData.find((d) => d.uid === account.uid)?.identification_hash;
		return hash && !account.identification_hash
			? { ...account, identification_hash: hash }
			: account;
	});
}

/** The stored status, or EXPIRED once the consent date has passed. */
export function sessionStatus(session: StoredSession, now = Date.now()): string | undefined {
	const expired = session.validUntil !== undefined && Date.parse(session.validUntil) <= now;
	if (expired && (session.status === undefined || session.status === 'AUTHORIZED')) {
		return 'EXPIRED';
	}
	return session.status;
}

/**
 * An authorization in progress while the browser is away at the bank: started
 * by POST /auth, completed by the callback route. Kept in device-only
 * settings, keyed by `state`, because a bank app may return to a new tab.
 */
export interface PendingAuth {
	state: string;
	aspsp: { name: string; country: string };
	/** ISO timestamp requested as access.valid_until. */
	validUntil: string;
	requiredPsuHeaders?: string[];
	/** ISO timestamp of the start. */
	createdAt: string;
}

export const PENDING_AUTH_TTL_MS = 60 * 60 * 1000;

/** The unexpired pending authorizations. */
async function loadPendingList(now: number): Promise<PendingAuth[]> {
	const stored = await deviceSettings.get<PendingAuth[]>(
		DeviceSettingKeys.enableBankingPendingAuth
	);
	if (!Array.isArray(stored)) return [];
	return stored.filter(
		(p) => typeof p?.state === 'string' && now - Date.parse(p.createdAt) < PENDING_AUTH_TTL_MS
	);
}

export function savePendingAuth(pending: PendingAuth, now = Date.now()): Promise<void> {
	return serialized(async () => {
		const others = (await loadPendingList(now)).filter((p) => p.state !== pending.state);
		await deviceSettings.set(DeviceSettingKeys.enableBankingPendingAuth, [...others, pending]);
	});
}

export async function findPendingAuth(
	state: string | null,
	now = Date.now()
): Promise<PendingAuth | null> {
	return (await loadPendingList(now)).find((p) => p.state === state) ?? null;
}

export function clearPendingAuth(state: string, now = Date.now()): Promise<void> {
	return serialized(async () => {
		const others = (await loadPendingList(now)).filter((p) => p.state !== state);
		await deviceSettings.set(DeviceSettingKeys.enableBankingPendingAuth, others);
	});
}

export function clearAllPendingAuth(): Promise<void> {
	return serialized(async () => {
		await deviceSettings.delete(DeviceSettingKeys.enableBankingPendingAuth);
	});
}
