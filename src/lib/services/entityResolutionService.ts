/*
	Supplies the ledger data `resolveEntities` (utils/entityResolution.ts) matches against.
	BQL is queried on demand — the ledger is in memory, so there is no cache to keep fresh:
	one distinct-payee list per resolution, and, for the matched payee only, its postings.

	Transactions still sitting in the working set (not yet exported/synced) are invisible to
	BQL, so they are merged in from the xact store, as the search service does.
*/
import fullLedgerService from '#lib/services/ledgerWorkerClient';
import { getXactStore } from '#lib/storage/xactStoreRegistry';
import {
	resolveEntities,
	type EntityLookup,
	type PostingObservation
} from '#lib/utils/entityResolution';
import type { ParseResult } from '#lib/utils/nlpEntry';

/** Account types that take part in resolution: what was bought, what paid, and income sources. */
const RESOLVABLE_ACCOUNTS = '^(Expenses|Assets|Liabilities|Income):';

function escapeBqlString(value: string): string {
	return value.replace(/'/g, "''");
}

async function deviceXacts() {
	try {
		return (await (await getXactStore()).list()).map(({ xact }) => xact);
	} catch {
		// No working-set store (e.g. nothing initialised yet) — BQL data alone is enough.
		return [];
	}
}

async function query(bql: string) {
	const result = await fullLedgerService.query(bql);
	if (result.errors?.length) {
		throw new Error((result.errors[0] as { message?: string }).message ?? 'BQL query failed');
	}
	return { columns: result.columns ?? [], rows: (result.rows ?? []) as unknown[][] };
}

export const ledgerEntityLookup: EntityLookup = {
	async listPayees() {
		const { columns, rows } = await query('SELECT DISTINCT payee ORDER BY payee');
		const idx = columns.indexOf('payee');
		const names = new Set(rows.map((row) => String(row[idx] ?? '')).filter(Boolean));
		for (const xact of await deviceXacts()) if (xact.payee) names.add(xact.payee);
		return [...names];
	},

	async payeePostings(payee: string) {
		const { columns, rows } = await query(
			`SELECT account, date, number WHERE payee = '${escapeBqlString(payee)}' AND account ~ "${RESOLVABLE_ACCOUNTS}"`
		);
		const accountIdx = columns.indexOf('account');
		const dateIdx = columns.indexOf('date');
		const numberIdx = columns.indexOf('number');
		const observations: PostingObservation[] = rows.map((row) => {
			const amount = parseFloat(String(row[numberIdx]));
			return {
				account: String(row[accountIdx] ?? ''),
				date: String(row[dateIdx] ?? ''),
				amount: Number.isFinite(amount) ? amount : undefined
			};
		});

		for (const xact of await deviceXacts()) {
			if (xact.payee !== payee) continue;
			for (const posting of xact.postings ?? []) {
				if (!new RegExp(RESOLVABLE_ACCOUNTS).test(posting.account)) continue;
				observations.push({
					account: posting.account,
					date: xact.date ?? '',
					amount: Number.isFinite(posting.amount) ? posting.amount : undefined
				});
			}
		}
		return observations;
	},

	async listAccounts() {
		const accounts = await fullLedgerService.getAllAccounts();
		return accounts.map((a) => a.name).filter(Boolean);
	}
};

/**
 * Resolves payee and accounts of a parse against the loaded book, in place. Best-effort:
 * with no book loaded or a failing query the plain parse stands.
 */
export async function resolveAgainstLedger(result: ParseResult, text: string): Promise<void> {
	try {
		await resolveEntities(result, text, ledgerEntityLookup);
	} catch (e) {
		console.warn('Entity resolution skipped:', e);
	}
}
