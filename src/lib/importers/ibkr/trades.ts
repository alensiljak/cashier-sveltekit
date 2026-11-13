/**
 * IBKR `<Trade>` rows to transactions: stock buys and forex conversions.
 *
 * Ported from the Python importer. Differences, on purpose:
 * - sells (with `<Lot>` rows), forex with a commission, and anything that is neither a stock buy
 *   nor a forex conversion create nothing and warn ("not supported yet", no real record to
 *   build on);
 * - an unknown symbol falls back to the ticker, flags the transaction `!` and warns.
 *
 * Merging: buys of one symbol at one price on one day become one transaction; forex
 * conversions of one pair on one day become one transaction.
 */
import { Posting, Xact } from '#lib/data/model';
import { Dec } from '#lib/utils/decimal';
import type { ImportedXact } from '../types';
import { fillTemplate } from './config';
import type { CashEnv } from './cashTransactions';
import { isoDate, type TradeRow } from './flexXml';
import { accountSymbol } from './symbols';

const FOREX_RE = /^(\w{3})\.(\w{3})$/;

interface DraftPosting {
	account: string;
	amount: Dec;
	currency: string;
	cost?: { amount: Dec; currency: string; date?: string };
	price?: { amount: Dec; currency: string };
}

interface Draft {
	date: string;
	payee: string;
	flag: string;
	postings: DraftPosting[];
	details: [string, string][];
	matchText: string[];
	/** Identifies the transactions that merge into one. */
	mergeKey: string;
}

const dateOf = (row: TradeRow) => isoDate(row.dateTime);

function skipped(env: CashEnv, row: TradeRow, why: string) {
	env.warnings.push(
		`Trade ${row.buySell} ${row.quantity} ${row.symbol} on ${dateOf(row)} not imported: ${why}.`
	);
}

function forex(row: TradeRow, env: CashEnv): Draft | undefined {
	const [, primary, secondary] = FOREX_RE.exec(row.symbol) as RegExpExecArray;
	if (row.proceeds === undefined || row.tradePrice === undefined) {
		skipped(env, row, 'it has no proceeds or price');
		return undefined;
	}
	if (row.ibCommission && !Dec.parse(row.ibCommission).isZero()) {
		skipped(env, row, 'a forex trade with a commission is not supported yet');
		return undefined;
	}

	const date = row.reportDate ? isoDate(row.reportDate) : dateOf(row);
	const payee = `FX ${row.symbol}`;
	return {
		date,
		payee,
		flag: '*',
		postings: [
			{
				account: fillTemplate(env.config.cashAccount, { currency: primary }),
				amount: Dec.parse(row.quantity),
				currency: primary,
				price: { amount: Dec.parse(row.tradePrice), currency: secondary }
			},
			{
				account: fillTemplate(env.config.cashAccount, { currency: secondary }),
				amount: Dec.parse(row.proceeds),
				currency: secondary
			}
		],
		details: [],
		matchText: [payee],
		mergeKey: JSON.stringify(['fx', date, payee])
	};
}

function stockBuy(row: TradeRow, env: CashEnv): Draft | undefined {
	if (row.tradePrice === undefined || row.netCash === undefined) {
		skipped(env, row, 'it has no price or net cash');
		return undefined;
	}

	let bookSymbol = env.symbols.resolve(row);
	const unknown = bookSymbol === undefined;
	if (unknown) {
		bookSymbol = row.symbol;
		env.warnings.push(
			`Unknown symbol ${row.symbol} (ISIN ${row.isin ?? '?'}) traded on ${dateOf(row)}: add the ISIN to the commodity in the book, or to the importer's symbols.`
		);
	}
	const symbol = bookSymbol as string;

	const currency = row.currency;
	const feeCurrency = row.ibCommissionCurrency ?? currency;
	const fees = Dec.parse(row.ibCommission ?? '0').add(Dec.parse(row.taxes ?? '0'));
	const date = dateOf(row);
	const costDate = row.tradeDate ? isoDate(row.tradeDate) : undefined;
	const price = Dec.parse(row.tradePrice);

	const postings: DraftPosting[] = [
		{
			account: fillTemplate(env.config.stockAccount, {
				currency,
				symbol: accountSymbol(symbol)
			}),
			amount: Dec.parse(row.quantity),
			currency: symbol,
			cost: { amount: price, currency, date: costDate }
		}
	];
	if (!fees.isZero()) {
		postings.push({
			account: fillTemplate(env.config.feesAccount, { currency: feeCurrency }),
			amount: fees.neg(),
			currency: feeCurrency
		});
	}
	postings.push({
		account: fillTemplate(env.config.cashAccount, { currency }),
		amount: Dec.parse(row.netCash),
		currency
	});

	const details: [string, string][] = [];
	if (row.isin) details.push(['ISIN', row.isin]);
	return {
		date,
		payee: `Buy ${symbol}`,
		flag: unknown ? '!' : '*',
		postings,
		details,
		matchText: [symbol],
		mergeKey: JSON.stringify(['buy', date, symbol, price.toString(), costDate ?? ''])
	};
}

/** Sums postings of the same (account, currency). Cost and price are taken from the first one. */
function sumPostings(postings: DraftPosting[]): DraftPosting[] {
	const sums = new Map<string, DraftPosting>();
	for (const p of postings) {
		const key = JSON.stringify([p.account, p.currency]);
		const existing = sums.get(key);
		if (existing) existing.amount = existing.amount.add(p.amount);
		else sums.set(key, { ...p });
	}
	return [...sums.values()];
}

function mergeGroup(group: Draft[]): Draft {
	const [base, ...rest] = group;
	const merged: Draft = {
		...base,
		postings: sumPostings(group.flatMap((d) => d.postings)),
		details: base.details
	};
	for (const other of rest) {
		for (const detail of other.details) {
			if (!merged.details.some(([k, v]) => k === detail[0] && v === detail[1])) {
				merged.details.push(detail);
			}
		}
	}
	return merged;
}

/**
 * A merged conversion is rounded (amounts to 4 decimals, the rate to 5) and priced on the
 * outgoing side, because the sum of many fractional-rate conversions has no exact rate.
 * Returns undefined when the sums do not form one conversion.
 */
function mergeForex(group: Draft[]): Draft | undefined {
	const merged = mergeGroup(group);
	if (merged.postings.length !== 2) return undefined;
	const [a, b]: DraftPosting[] = merged.postings.map((p) => ({
		account: p.account,
		currency: p.currency,
		amount: p.amount.quantize(4)
	}));
	const outgoing = a.amount.sign < 0 ? a : b.amount.sign < 0 ? b : undefined;
	const incoming = outgoing === a ? b : a;
	if (!outgoing || incoming.amount.sign <= 0) return undefined;

	outgoing.price = {
		amount: incoming.amount.div(outgoing.amount, 5).abs(),
		currency: incoming.currency
	};
	merged.postings = [a, b];
	return merged;
}

function toImported(draft: Draft): ImportedXact {
	const xact = new Xact();
	xact.date = draft.date;
	xact.payee = draft.payee;
	xact.note = '';
	xact.flag = draft.flag;
	xact.postings = draft.postings.map((p) => {
		const posting = new Posting();
		posting.account = p.account;
		posting.amount = p.amount.toNumber();
		posting.currency = p.currency;
		if (p.cost) {
			posting.costAmount = p.cost.amount.toNumber();
			posting.costCurrency = p.cost.currency;
			if (p.cost.date) posting.costDate = p.cost.date;
		}
		if (p.price) {
			posting.priceAmount = p.price.amount.toNumber();
			posting.priceCurrency = p.price.currency;
		}
		return posting;
	});
	return { xact, details: draft.details, matchText: draft.matchText };
}

/** Transactions for all trade rows of the statement. */
export function trades(rows: TradeRow[], env: CashEnv): ImportedXact[] {
	const drafts: Draft[] = [];
	for (const row of rows) {
		let draft: Draft | undefined;
		if (FOREX_RE.test(row.symbol) && !row.isin && row.transactionType === 'ExchTrade') {
			draft = forex(row, env);
		} else if (FOREX_RE.test(row.symbol)) {
			// Looks like a currency pair but has an ISIN (e.g. a rights issue line such as TCF.RTS0).
			skipped(env, row, `${row.transactionType ?? 'this kind of'} trade is not supported yet`);
		} else if (row.buySell === 'BUY' && row.openCloseIndicator === 'O') {
			draft = stockBuy(row, env);
		} else {
			skipped(env, row, 'only stock buys and forex conversions are supported so far');
		}
		if (draft) drafts.push(draft);
	}

	const groups = new Map<string, Draft[]>();
	for (const d of drafts) groups.set(d.mergeKey, [...(groups.get(d.mergeKey) ?? []), d]);

	const result: Draft[] = [];
	for (const group of groups.values()) {
		if (group.length === 1) {
			result.push(group[0]);
		} else if (group[0].mergeKey.startsWith('["fx"')) {
			const merged = mergeForex(group);
			if (merged) result.push(merged);
			else {
				env.warnings.push(
					`Forex trades ${group[0].payee} on ${group[0].date} could not be merged; kept separate.`
				);
				result.push(...group);
			}
		} else {
			result.push(mergeGroup(group));
		}
	}
	return result.map(toImported);
}
