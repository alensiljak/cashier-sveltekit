/**
 * Operations on a connected bank that involve both the API and the device's
 * stores, shared by the config form, the operations page and Reset.
 */
import { EbError, type EnableBankingClient } from './api';
import { clearCredentials } from './auth';
import { clearBalanceCache, removeSessionBalances } from './balances';
import {
	clearAllPendingAuth,
	clearSessions,
	loadSessions,
	mergeSessionAccounts,
	removeSession,
	updateSession,
	type StoredSession
} from './sessions';

/** Fetch a session's live status, consent date and accounts. Returns the list. */
export async function syncSession(
	client: Pick<EnableBankingClient, 'getSession'>,
	sessionId: string
): Promise<StoredSession[]> {
	const live = await client.getSession(sessionId);
	return updateSession(sessionId, (session) => ({
		...session,
		status: live.status ?? session.status,
		validUntil: live.access?.valid_until ?? session.validUntil,
		// GET /sessions/{id} returns account IDs only; keep the rich accounts.
		accounts: mergeSessionAccounts(session.accounts, live.accounts, live.accounts_data)
	}));
}

/** Remove a session from this device only; the consent is not revoked. */
export async function forgetSession(sessionId: string): Promise<StoredSession[]> {
	const sessions = await removeSession(sessionId);
	await removeSessionBalances(sessionId);
	return sessions;
}

/**
 * Revoke the consent, then forget the session. If revoking fails, the session
 * is kept so it can be retried. A 404 means there is nothing left to revoke.
 */
export async function revokeSession(
	client: Pick<EnableBankingClient, 'deleteSession'>,
	sessionId: string
): Promise<StoredSession[]> {
	try {
		await client.deleteSession(sessionId);
	} catch (e) {
		if (!(e instanceof EbError && e.status === 404)) throw e;
	}
	return forgetSession(sessionId);
}

export interface RevokeFailure {
	session: StoredSession;
	message: string;
}

/**
 * Revoke every session and delete the credentials. If any revocation fails,
 * the credentials and the failed sessions are kept and the failures returned.
 * Without a client (no credentials) there is nothing that could revoke.
 */
export async function disconnectEnableBanking(
	client: Pick<EnableBankingClient, 'deleteSession'> | null
): Promise<RevokeFailure[]> {
	const failures: RevokeFailure[] = [];
	if (client) {
		for (const session of await loadSessions()) {
			try {
				await revokeSession(client, session.sessionId);
			} catch (e) {
				failures.push({ session, message: e instanceof Error ? e.message : String(e) });
			}
		}
	}
	if (failures.length) return failures;
	await clearSessions();
	await clearBalanceCache();
	await clearAllPendingAuth();
	await clearCredentials();
	return [];
}

export function describeFailures(failures: RevokeFailure[]): string {
	const details = failures.map((f) => `${f.session.aspsp.name}: ${f.message}`).join('; ');
	return `Could not revoke the consent, so the connection was kept (${details}). Use Remove to retry; if that fails, use Forget locally.`;
}
