import { Posting, Xact } from '#lib/data/model';
import fullLedgerService from '#lib/services/ledgerWorkerClient';
import { metaFromBqlEntry } from '#lib/utils/transactionParser';
import { commoditiesFromDirectives } from '#lib/assetAllocation/commodityYield';

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
 * Every recorded transaction between `from` and `to` (ISO dates), with all its postings, for
 * importers that bring their own duplicate rule.
 */
export async function loadExistingXacts(from: string, to: string): Promise<Xact[]> {
	await fullLedgerService.ensureLoaded();
	const bql = `SELECT id, date, payee, narration, account, number, currency WHERE date >= ${from} AND date <= ${to}`;
	const { columns, rows } = await fullLedgerService.query(bql);
	const idx = (name: string) => columns.indexOf(name);

	const byId = new Map<number, Xact>();
	for (const row of rows) {
		const id = Number(row[idx('id')]);
		let x = byId.get(id);
		if (!x) {
			x = new Xact();
			x.id = id;
			x.date = String(row[idx('date')]);
			x.payee = (row[idx('payee')] as string | null) ?? '';
			x.note = (row[idx('narration')] as string | null) ?? '';
			byId.set(id, x);
		}
		const p = new Posting();
		p.account = String(row[idx('account')]);
		p.amount = parseFloat(String(row[idx('number')]));
		p.currency = String(row[idx('currency')]);
		x.postings.push(p);
	}
	return [...byId.values()];
}

/**
 * The whole recorded transaction (all postings) that `summary` was loaded from,
 * for showing what an imported row matched. Falls back to `summary` if it can't be read.
 */
export async function loadFullXact(summary: Xact): Promise<Xact> {
	if (summary.id == null) return summary;
	try {
		const { columns, rows } = await fullLedgerService.query(
			`SELECT flag, account, number, currency, entry WHERE id = ${summary.id}`
		);
		if (rows.length === 0) return summary;
		const idx = (name: string) => columns.indexOf(name);
		const x = new Xact();
		x.id = summary.id;
		x.date = summary.date;
		x.payee = summary.payee;
		x.note = summary.note;
		x.flag = (rows[0][idx('flag')] as string) ?? '*';
		x.meta = metaFromBqlEntry(rows[0][idx('entry')]);
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

/** Every (commodity symbol, ISIN) pair, from the `isin` metadata on the book's commodity directives. */
export async function loadSymbolIsins(): Promise<[string, string][]> {
	await fullLedgerService.ensureLoaded();
	const commodities = commoditiesFromDirectives(
		(await fullLedgerService.getDirectives()) as unknown[]
	);
	const pairs: [string, string][] = [];
	for (const c of commodities) {
		const isin = c.meta?.isin;
		if (typeof isin === 'string' && isin) pairs.push([c.currency, isin]);
	}
	return pairs;
}

/**
 * Commodity symbol -> the value of its `distribution` metadata (e.g. `interest`): which kind of
 * income the security's distributions are booked as. Securities without the tag are left out.
 */
export async function loadDistributionKinds(): Promise<Record<string, string>> {
	await fullLedgerService.ensureLoaded();
	const commodities = commoditiesFromDirectives(
		(await fullLedgerService.getDirectives()) as unknown[]
	);
	const kinds: Record<string, string> = {};
	for (const c of commodities) {
		const kind = c.meta?.distribution;
		if (typeof kind === 'string' && kind) kinds[c.currency] = kind.trim().toLowerCase();
	}
	return kinds;
}

/** ISIN -> commodity symbol. With a dual listing the last one wins; see `loadSymbolIsins`. */
export async function loadIsinSymbols(): Promise<Record<string, string>> {
	const map: Record<string, string> = {};
	for (const [symbol, isin] of await loadSymbolIsins()) map[isin] = symbol;
	return map;
}
