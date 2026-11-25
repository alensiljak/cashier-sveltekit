/**
 * Typed client for the Enable Banking API (https://api.enablebanking.com —
 * the same host serves sandbox and production; the application ID in the
 * signed JWT decides the environment). Shapes mirror the API reference
 * (enablebanking.com/docs/api/reference); fields the UI relies on are
 * required, the rest optional, so an endpoint change degrades gracefully.
 *
 * The browser cannot reach the host directly (CORS), so every call goes
 * through the app's same-origin proxy (proxyFetch) with the signed JWT as
 * `upstreamBearer`. The proxy only forwards it to api.enablebanking.com
 * (worker/proxy.ts).
 */
import { proxyFetch } from '#lib/services/prices/proxyFetch';
import type { StoredCredentials } from './auth';
import { EnableBankingTokenSource } from './auth';

export const EB_API_BASE = 'https://api.enablebanking.com';

/** The consent redirect route of this app; must be whitelisted for the app in the Control Panel. */
export function ebCallbackUrl(origin: string): string {
	return `${origin.replace(/\/+$/, '')}/importers/enable-banking/callback`;
}

export class EbError extends Error {
	constructor(
		readonly status: number | null,
		readonly code: string | null,
		message: string
	) {
		super(message);
		this.name = 'EbError';
	}
}

/** GET /application — the registered app itself (used to verify credentials). */
export interface EbApplication {
	id?: string;
	name?: string;
	environment?: string;
	redirect_urls?: string[];
	[key: string]: unknown;
}

export interface EbAspspCredential {
	name: string;
	required?: boolean;
	description?: string;
	template?: string;
	title?: string;
}

export interface EbAspspAuthMethod {
	approach?: string;
	name?: string;
	psu_type?: string;
	hidden_method?: boolean;
	credentials?: EbAspspCredential[];
}

export interface EbAspsp {
	name: string;
	country: string;
	bic?: string;
	logo?: string;
	beta?: boolean;
	/** Maximum consent lifetime in seconds, from GET /aspsps. */
	maximum_consent_validity?: number;
	auth_methods?: EbAspspAuthMethod[];
	payments?: unknown[];
}

export interface EbAspspsResponse {
	aspsps: EbAspsp[];
}

/** POST /auth — start user authorization; the response URL is where the user is sent. */
export interface EbStartAuthorizationRequest {
	access: {
		balances: boolean;
		transactions: boolean;
		/** ISO 8601; capped by the ASPSP's maximum_consent_validity. */
		valid_until: string;
	};
	aspsp: { name: string; country: string };
	/** Echoed back on the redirect; checked by the callback route. */
	state: string;
	/** Must match a redirect URL whitelisted for the app. */
	redirect_url: string;
	psu_type?: string;
}

export interface EbStartAuthorizationResponse {
	url: string;
	authorization_id?: string;
	psu_id_hash?: string;
}

/** An account made available by a session (POST /sessions, GET /sessions/{id}). */
export interface EbSessionAccount {
	/** Unique account ID used in /accounts/{uid}/… URLs; valid while the session is AUTHORIZED. */
	uid: string;
	account_id?: {
		iban?: string;
		other?: { identification?: string; scheme_name?: string };
	};
	cash_account_type?: string;
	currency?: string;
	details?: string;
	identification_hash?: string;
	name?: string;
	usage?: string;
}

/** POST /sessions (exchange the redirect `code`) — the accounts are shown only once. */
export interface EbAuthorizeSessionResponse {
	session_id: string;
	accounts: EbSessionAccount[];
}

/** GET /sessions/{session_id}. */
export interface EbSession {
	session_id?: string;
	id?: string;
	status?: string;
	accounts?: EbSessionAccount[];
	valid_until?: string;
	psu_id_hash?: string;
	[key: string]: unknown;
}

export interface EbBalance {
	balance_amount?: { amount?: string; currency?: string };
	balance_type?: string;
	reference_date?: string;
	last_change_date_time?: string;
	last_committed_transaction?: string;
}

export interface EbBalancesResponse {
	balances: EbBalance[];
	_links?: Record<string, { href?: string } | undefined>;
}

export interface EbTransaction {
	transaction_id?: string;
	entry_reference?: string;
	status?: string;
	booking_date?: string;
	booking_date_time?: string;
	value_date?: string;
	value_date_time?: string;
	transaction_date?: string;
	/** "CRDT" (money in) or "DBIT" (money out). */
	credit_debit_indicator?: string;
	transaction_amount?: { amount?: string; currency?: string };
	/** Some ASPSPs send amount/currency at the top level instead. */
	amount?: string;
	currency?: string;
	creditor?: { name?: string; postal_address?: unknown };
	debtor?: { name?: string };
	creditor_account?: { iban?: string };
	debtor_account?: { iban?: string };
	remittance_information?: string[] | string;
	bank_transaction_code?: { code?: string; sub_code?: string; description?: string };
	proprietary_bank_transaction_code?: string;
	balance_after_transaction?: string | { amount?: string; currency?: string };
	merchant_category_code?: string;
	reference_number?: string;
	[key: string]: unknown;
}

export interface EbTransactionsResponse {
	transactions: EbTransaction[];
	/** Present when more pages exist; pass back as the continuation_key query param. */
	continuation_key?: string;
	_links?: { next?: { href?: string } };
}

export interface EbTransactionsQuery {
	/** ISO date, YYYY-MM-DD. */
	dateFrom?: string;
	dateTo?: string;
	continuationKey?: string;
}

export interface EbClientOptions {
	credentials: StoredCredentials;
	/** Overridable for tests. */
	baseUrl?: string;
	/** Injectable transport; defaults to the CORS proxy. */
	fetchImpl?: typeof proxyFetch;
	/** Injectable token source; defaults to signing with the credentials. */
	tokenSource?: { getToken(): Promise<string> };
}

type Query = Record<string, string | undefined>;

export class EnableBankingClient {
	private readonly baseUrl: string;
	private readonly fetchImpl: typeof proxyFetch;
	private readonly tokenSource: { getToken(): Promise<string> };

	constructor(options: EbClientOptions) {
		this.baseUrl = (options.baseUrl ?? EB_API_BASE).replace(/\/+$/, '');
		this.fetchImpl = options.fetchImpl ?? proxyFetch;
		this.tokenSource = options.tokenSource ?? new EnableBankingTokenSource(options.credentials);
	}

	private async request<T>(
		method: 'GET' | 'POST' | 'DELETE',
		path: string,
		opts: { query?: Query; body?: unknown } = {}
	): Promise<T> {
		const url = new URL(this.baseUrl + path);
		for (const [key, value] of Object.entries(opts.query ?? {})) {
			if (value !== undefined) url.searchParams.set(key, value);
		}
		const response = await this.fetchImpl(url.toString(), {
			method,
			headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
			upstreamBearer: await this.tokenSource.getToken()
		});
		if (!response.ok) {
			const data = (await response.json().catch(() => ({}))) as {
				error?: string;
				detail?: string;
			};
			const code = typeof data.error === 'string' ? data.error : null;
			const detail = typeof data.detail === 'string' ? data.detail : '';
			throw new EbError(
				response.status,
				code,
				`Enable Banking request failed (HTTP ${response.status})${code ? ` ${code}` : ''}${detail ? `: ${detail}` : ''}`
			);
		}
		if (response.status === 204) return undefined as T;
		return (await response.json()) as T;
	}

	/** App info — the reachability/credential check. */
	getApplication(): Promise<EbApplication> {
		return this.request('GET', '/application');
	}

	listAspsps(query: { country?: string; psuType?: string } = {}): Promise<EbAspspsResponse> {
		return this.request('GET', '/aspsps', {
			query: { country: query.country, psu_type: query.psuType }
		});
	}

	/** Start user authorization; returns the URL the user must be sent to. */
	startAuthorization(body: EbStartAuthorizationRequest): Promise<EbStartAuthorizationResponse> {
		return this.request('POST', '/auth', { body });
	}

	/** Exchange the redirect `code` for a session. */
	authorizeSession(code: string): Promise<EbAuthorizeSessionResponse> {
		return this.request('POST', '/sessions', { body: { code } });
	}

	getSession(sessionId: string): Promise<EbSession> {
		return this.request('GET', `/sessions/${encodeURIComponent(sessionId)}`);
	}

	/** Revoke a session (consent) server-side. */
	deleteSession(sessionId: string): Promise<void> {
		return this.request('DELETE', `/sessions/${encodeURIComponent(sessionId)}`);
	}

	getBalances(accountUid: string): Promise<EbBalancesResponse> {
		return this.request('GET', `/accounts/${encodeURIComponent(accountUid)}/balances`);
	}

	getTransactions(
		accountUid: string,
		query: EbTransactionsQuery = {}
	): Promise<EbTransactionsResponse> {
		return this.request('GET', `/accounts/${encodeURIComponent(accountUid)}/transactions`, {
			query: {
				date_from: query.dateFrom,
				date_to: query.dateTo,
				continuation_key: query.continuationKey
			}
		});
	}

	getTransactionDetails(accountUid: string, transactionId: string): Promise<EbTransaction> {
		return this.request(
			'GET',
			`/accounts/${encodeURIComponent(accountUid)}/transactions/${encodeURIComponent(transactionId)}`
		);
	}

	/**
	 * Fetch every transaction page in the range (following continuation_key,
	 * capped so a pathological ASPSP cannot loop forever).
	 */
	async fetchAllTransactions(
		accountUid: string,
		query: Omit<EbTransactionsQuery, 'continuationKey'> = {},
		maxPages = 100
	): Promise<EbTransaction[]> {
		const all: EbTransaction[] = [];
		let continuationKey: string | undefined;
		for (let page = 0; page < maxPages; page++) {
			const response = await this.getTransactions(accountUid, { ...query, continuationKey });
			all.push(...(response.transactions ?? []));
			continuationKey = response.continuation_key;
			if (!continuationKey) break;
		}
		return all;
	}
}
