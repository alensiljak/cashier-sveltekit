import { Posting, Xact } from '$lib/data/model';
import fullLedgerService from '$lib/services/ledgerWorkerClient';
import { commoditiesFromDirectives } from '$lib/assetAllocation/commodityYield';

/**
 * The full journal already contains both the archived books and the working set,
 * so a single query covers everything that is recorded.
 */

/**
 * Transactions already recorded against `account` between `from` and `to`
 * (ISO dates). Only the bank posting is returned, which is all duplicate
 * detection looks at, plus payee/narration to show the user what was matched.
 */
export async function loadExistingBankXacts(
	account: string,
	from: string,
	to: string
): Promise<Xact[]> {
	await fullLedgerService.ensureLoaded();
	const quoted = account.replace(/'/g, "\\'");
	const bql = `SELECT id, date, payee, narration, number, currency WHERE account = '${quoted}' AND date >= ${from} AND date <= ${to}`;
	const { columns, rows } = await fullLedgerService.query(bql);
	const idx = (name: string) => columns.indexOf(name);

	return rows.map((row) => {
		const x = new Xact();
		x.id = Number(row[idx('id')]);
		x.date = String(row[idx('date')]);
		x.payee = (row[idx('payee')] as string | null) ?? '';
		x.note = (row[idx('narration')] as string | null) ?? '';
		const p = new Posting();
		p.account = account;
		p.amount = parseFloat(String(row[idx('number')]));
		p.currency = String(row[idx('currency')]);
		x.postings = [p];
		return x;
	});
}

/**
 * The whole recorded transaction (all postings) that `summary` was loaded from,
 * for showing what an imported row matched. Falls back to `summary` if it can't be read.
 */
export async function loadFullXact(summary: Xact): Promise<Xact> {
	if (summary.id == null) return summary;
	try {
		const { columns, rows } = await fullLedgerService.query(
			`SELECT flag, account, number, currency WHERE id = ${summary.id}`
		);
		if (rows.length === 0) return summary;
		const idx = (name: string) => columns.indexOf(name);
		const x = new Xact();
		x.id = summary.id;
		x.date = summary.date;
		x.payee = summary.payee;
		x.note = summary.note;
		x.flag = (rows[0][idx('flag')] as string) ?? '*';
		x.postings = rows.map((r) => {
			const p = new Posting();
			p.account = String(r[idx('account')]);
			p.amount = parseFloat(String(r[idx('number')]));
			p.currency = String(r[idx('currency')]);
			return p;
		});
		return x;
	} catch {
		return summary;
	}
}

/** ISIN -> commodity symbol, from the `isin` metadata on the book's commodity directives. */
export async function loadIsinSymbols(): Promise<Record<string, string>> {
	await fullLedgerService.ensureLoaded();
	const commodities = commoditiesFromDirectives(
		(await fullLedgerService.getDirectives()) as unknown[]
	);
	const map: Record<string, string> = {};
	for (const c of commodities) {
		const isin = c.meta?.isin;
		if (typeof isin === 'string' && isin) map[isin] = c.currency;
	}
	return map;
}
