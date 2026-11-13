/**
 * Balance assertions from the statement's `<CashReport>` and `<OpenPositions>`, dated the day
 * after the statement's end (Beancount checks an assertion at the start of its day).
 *
 * The `BASE_SUMMARY` cash line is the total in the base currency, not an account; it is skipped.
 * An unknown stock symbol falls back to the ticker, flags the assertion `!` and warns.
 */
import { Xact } from '#lib/data/model';
import { Dec } from '#lib/utils/decimal';
import type { ImportedXact } from '../types';
import { fillTemplate } from './config';
import type { CashEnv } from './cashTransactions';
import { addDays, type FlexStatement } from './flexXml';
import { accountSymbol } from './symbols';

function assertion(
	date: string,
	account: string,
	amount: string,
	currency: string,
	flag = '*'
): Xact {
	const number = Dec.parse(amount).toNumber();
	const xact = new Xact();
	xact.date = date;
	xact.flag = flag;
	xact.payee = 'Balance assertion';
	xact.note = `${account} = ${number} ${currency}`;
	xact.postings = [];
	xact.balanceAssertion = { account, amount: number, currency };
	return xact;
}

/** Cash and stock balance assertions for the statement. */
export function balances(statement: FlexStatement, env: CashEnv): ImportedXact[] {
	const result: ImportedXact[] = [];

	for (const row of statement.cashReport) {
		if (row.currency === 'BASE_SUMMARY') continue;
		const account = fillTemplate(env.config.cashAccount, { currency: row.currency });
		result.push({
			xact: assertion(addDays(row.toDate, 1), account, row.endingCash, row.currency),
			details: [],
			matchText: [account]
		});
	}

	const date = addDays(statement.toDate, 1);
	for (const row of statement.openPositions) {
		let symbol = env.symbols.resolve(row);
		const unknown = symbol === undefined;
		if (unknown) {
			symbol = row.symbol;
			env.warnings.push(
				`Unknown symbol ${row.symbol} (ISIN ${row.isin ?? '?'}) in the open positions: add the ISIN to the commodity in the book, or to the importer's symbols.`
			);
		}
		const bookSymbol = symbol as string;
		const account = fillTemplate(env.config.stockAccount, {
			symbol: accountSymbol(bookSymbol)
		});
		const details: [string, string][] = row.isin ? [['ISIN', row.isin]] : [];
		result.push({
			xact: assertion(date, account, row.position, bookSymbol, unknown ? '!' : '*'),
			details,
			matchText: [account]
		});
	}
	return result;
}
