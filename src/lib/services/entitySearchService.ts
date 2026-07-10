/*
	Query execution for the /search page. Builds and runs the BQL queries for each
	implemented entity category (payees, accounts, commodities, transactions-by-narration)
	against the full ledger, plus the on-device (unsynced) transaction merge that the
	payee-xacts page also does, so search results and their tap destination stay
	consistent with the rest of the app.
*/
import fullLedgerService from '$lib/services/ledgerWorkerClient';
import { STOP_WORDS } from '$lib/utils/nlpEntry';
import ledgerService from '$lib/services/ledgerService';
import { Xact, Posting } from '$lib/data/model';
import type { DirectiveSpan } from '$lib/rledger/sourceEditor';
import type { EntityCategory, EntitySearchTerm } from '$lib/utils/entitySearch';

const FIELD_FOR_CATEGORY: Record<Exclude<EntityCategory, 'any'>, string> = {
	payee: 'payee',
	account: 'account',
	narration: 'narration',
	commodity: 'currency'
};

/**
 * Builds AND'd BQL WHERE conditions for `terms`. Each term maps to the BQL field of its
 * explicit category (an @/#/~/$ prefix) if it has one, otherwise to `targetCategory` — so
 * an unprefixed term adapts to whichever entity section is currently being queried, while
 * an explicit prefix keeps filtering on its own field across every section (cross-entity AND).
 */
export function buildConditions(
	terms: EntitySearchTerm[],
	categories: EntityCategory[],
	targetCategory: Exclude<EntityCategory, 'any'>
): string[] {
	return terms.map((term, i) => {
		const category = categories[i];
		const field = FIELD_FOR_CATEGORY[category === 'any' ? targetCategory : category];
		const escaped = term.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		return `${field} ~ "(?i)${escaped}"`;
	});
}

/** Term looks like a bare amount ("10", "9.99") — no letters, no explicit category prefix. */
const AMOUNT_TERM = /^\d+(\.\d+)?$/;

/**
 * Builds AND'd BQL WHERE conditions for `terms`, for transaction search only. An
 * explicit-category term (@/#/~/$ prefix) still pins to its own field, same as
 * `buildConditions`. But an unprefixed term ORs across payee/narration/account,
 * so terse fragments like "deca hik" can match "Decathlon" as payee and
 * "Expenses:Sport:Hiking" as account without needing prefixes — unlike the
 * single-field-per-section AND that `buildConditions` gives every other entity
 * category (payees/accounts/commodities).
 *
 * A bare-number term ("10", "9.99") or a currency/connector filler word (from
 * `STOP_WORDS` — "euros", "for", "at", …) is dropped entirely rather than turned into a
 * filter: a remembered amount is rarely exact (users round, misremember, or the amount
 * includes fees/tips not on the matched historical transaction), and filler words never
 * appear literally in a transaction's payee/narration/account text (STT output like
 * "decathlon 10 euros." would otherwise AND in an unmatchable "euros" clause and hide the
 * correct payee match). Both are still parsed for the *new* suggested transaction elsewhere
 * (`parseTranscript`) — they just never exclude an existing transaction from the results.
 */
export function buildLooseTransactionConditions(
	terms: EntitySearchTerm[],
	categories: EntityCategory[]
): string[] {
	const clauses: string[] = [];
	terms.forEach((term, i) => {
		const category = categories[i];
		if (category === 'any') {
			const normalized = term.value.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
			if (AMOUNT_TERM.test(normalized) || STOP_WORDS.has(normalized)) return;
		}
		const escaped = term.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		if (category !== 'any') {
			clauses.push(`${FIELD_FOR_CATEGORY[category]} ~ "(?i)${escaped}"`);
			return;
		}
		const fields = ['payee', 'narration', 'account'];
		clauses.push('(' + fields.map((f) => `${f} ~ "(?i)${escaped}"`).join(' OR ') + ')');
	});
	return clauses;
}

async function searchDistinct(field: string, conditions: string[]): Promise<string[]> {
	if (conditions.length === 0) return [];
	const bql = `SELECT DISTINCT ${field} WHERE ${conditions.join(' AND ')} ORDER BY ${field}`;
	const { columns, rows } = await fullLedgerService.query(bql);
	const idx = columns.indexOf(field);
	return (rows as unknown[][]).map((row) => String(row[idx] ?? '')).filter(Boolean);
}

export const searchPayees = (conditions: string[]) => searchDistinct('payee', conditions);
export const searchAccounts = (conditions: string[]) => searchDistinct('account', conditions);
export const searchCommodities = (conditions: string[]) => searchDistinct('currency', conditions);

export interface TransactionResult {
	xact: Xact;
	span?: DirectiveSpan;
}

/**
 * Full transactions (grouped postings) matching `conditions`, merged with on-device rows
 * from the live cashier.bean source (which carry an editable DirectiveSpan) — mirrors the
 * payee-xacts page's device/ledger merge. `termValues` approximates the same AND filter
 * against device rows, which aren't queryable via BQL, by substring-matching the term
 * values against each device xact's payee/narration/account text.
 */
export async function searchTransactions(
	conditions: string[],
	termValues: string[]
): Promise<TransactionResult[]> {
	if (conditions.length === 0) return [];

	await ledgerService.load();
	const xactsWithSpans = await ledgerService.getXactsWithSpans();
	const deviceRows: TransactionResult[] = xactsWithSpans
		.filter(({ xact }) => {
			const haystack = [xact.payee, xact.note, ...(xact.postings ?? []).map((p) => p.account)]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();
			return termValues.every((term) => haystack.includes(term));
		})
		.map(({ xact, span }) => ({ xact, span }));

	const bql = `SELECT id, date, flag, payee, narration, account, number, currency WHERE ${conditions.join(' AND ')} ORDER BY date DESC`;
	const { columns, rows } = await fullLedgerService.query(bql);
	const safeColumns = columns ?? [];
	const safeRows = (rows ?? []) as unknown[][];

	const idIdx = safeColumns.indexOf('id');
	const dateIdx = safeColumns.indexOf('date');
	const flagIdx = safeColumns.indexOf('flag');
	const payeeIdx = safeColumns.indexOf('payee');
	const narrationIdx = safeColumns.indexOf('narration');
	const accountIdx = safeColumns.indexOf('account');
	const numberIdx = safeColumns.indexOf('number');
	const currencyIdx = safeColumns.indexOf('currency');

	const byId = new Map<string, Xact>();
	for (const row of safeRows) {
		const id = String(row[idIdx]);
		let xact = byId.get(id);
		if (!xact) {
			xact = new Xact();
			xact.date = row[dateIdx] as string;
			xact.flag = (row[flagIdx] as string) ?? '*';
			xact.payee = (row[payeeIdx] as string) ?? '';
			xact.note = (row[narrationIdx] as string) ?? '';
			byId.set(id, xact);
		}
		const posting = new Posting();
		posting.account = row[accountIdx] as string;
		posting.amount = parseFloat(row[numberIdx] as string);
		posting.currency = row[currencyIdx] as string;
		xact.postings.push(posting);
	}
	const ledgerRows: TransactionResult[] = Array.from(byId.values()).map((xact) => ({ xact }));

	// Device rows shadow matching ledger rows (same date/payee/narration) — same rule as payee-xacts.
	const unmatchedLedgerRows = ledgerRows.filter(
		(lr) =>
			!deviceRows.some(
				(dr) =>
					dr.xact.date === lr.xact.date &&
					(dr.xact.payee ?? '') === (lr.xact.payee ?? '') &&
					(dr.xact.note ?? '') === (lr.xact.note ?? '')
			)
	);

	return [...deviceRows, ...unmatchedLedgerRows].sort((a, b) =>
		(b.xact.date ?? '').localeCompare(a.xact.date ?? '')
	);
}
