import fullLedgerService from '#lib/services/ledgerWorkerClient';
import { latestAssertion, type BalanceAssertion } from './reconciliation';

function escapeBqlString(value: string): string {
	return value.replace(/'/g, "''");
}

export interface AccountPosting {
	id: number;
	date: string;
	payee: string;
	narration: string;
	flag: string;
	amount: number;
}

/**
 * The latest balance assertion for the account and currency dated on or before `onOrBefore`.
 * Whether that assertion passes is not checked here.
 */
export async function loadLatestAssertion(
	account: string,
	currency: string,
	onOrBefore: string
): Promise<BalanceAssertion | undefined> {
	await fullLedgerService.ensureLoaded();
	return latestAssertion(await fullLedgerService.getDirectives(), account, currency, onOrBefore);
}

/**
 * Postings to `account` in one currency between `from` and `to` (inclusive ISO dates),
 * oldest first. Omit `from` to start at the beginning of the book.
 */
export async function loadAccountPostings(
	account: string,
	currency: string,
	to: string,
	from?: string
): Promise<AccountPosting[]> {
	await fullLedgerService.ensureLoaded();
	const fromClause = from ? ` AND date >= ${from}` : '';
	const bql = `SELECT id, date, payee, narration, flag, number WHERE account = '${escapeBqlString(account)}' AND currency = '${escapeBqlString(currency)}'${fromClause} AND date <= ${to} ORDER BY date`;
	const { columns, rows, errors } = await fullLedgerService.query(bql);
	if (errors?.length) throw new Error(String(errors[0]));
	const idx = (name: string) => columns.indexOf(name);
	return rows.map((row) => ({
		id: Number(row[idx('id')]),
		date: String(row[idx('date')]),
		payee: (row[idx('payee')] as string | null) ?? '',
		narration: (row[idx('narration')] as string | null) ?? '',
		flag: (row[idx('flag')] as string | null) ?? '*',
		amount: parseFloat(String(row[idx('number')]))
	}));
}

/**
 * The account's balance in one currency at the end of `asOf` (ISO date), i.e.
 * including transactions dated on that day. The full journal contains both the
 * archived books and the working set, so device entries are included.
 */
export async function loadBookBalance(
	account: string,
	currency: string,
	asOf: string
): Promise<number> {
	await fullLedgerService.ensureLoaded();
	const bql = `SELECT sum(number) AS balance WHERE account = '${escapeBqlString(account)}' AND currency = '${escapeBqlString(currency)}' AND date <= ${asOf}`;
	const { columns, rows, errors } = await fullLedgerService.query(bql);
	if (errors?.length) throw new Error(String(errors[0]));
	if (rows.length === 0) return 0;
	const value = rows[0][columns.indexOf('balance')];
	if (value === null || value === undefined || value === '') return 0;
	const n = parseFloat(String(value));
	return isNaN(n) ? 0 : n;
}
