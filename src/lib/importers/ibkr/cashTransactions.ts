/**
 * IBKR `<CashTransaction>` rows to transactions: deposits, dividends and fund distributions with
 * their withholding tax, fees and broker interest.
 *
 * Ported from the Python importer. Differences, on purpose:
 * - all distributions are income (no separate interest account);
 * - an unknown symbol falls back to the ticker, flags the transaction `!` and warns, instead of
 *   raising;
 * - an unrecognized row type creates nothing and warns;
 * - the date of a withholding-tax reversal is kept as transaction metadata `tax-reversal-date`.
 */
import { Posting, Xact } from '#lib/data/model';
import { Dec } from '#lib/utils/decimal';
import { PLACEHOLDER_ACCOUNT } from '#lib/utils/xactUtils';
import type { ImportedXact } from '../types';
import { fillTemplate, type IbkrConfig } from './config';
import { isoDate, type CashTransactionRow } from './flexXml';
import { accountSymbol, type SymbolMap } from './symbols';

const TYPE = {
	deposit: 'Deposits/Withdrawals',
	interestReceived: 'Broker Interest Received',
	interestPaid: 'Broker Interest Paid',
	fees: 'Other Fees',
	commissionAdjustment: 'Commission Adjustments',
	dividend: 'Dividends',
	paymentInLieu: 'Payment In Lieu Of Dividends',
	withholdingTax: 'Withholding Tax'
} as const;

export interface CashEnv {
	config: IbkrConfig;
	symbols: SymbolMap;
	/** Book symbol -> `distribution` metadata of its commodity. */
	distributionKinds?: Record<string, string>;
	warnings: string[];
}

interface DraftPosting {
	account: string;
	amount: Dec;
	currency: string;
	/** A tax reversal is never summed with other postings of the same account. */
	reversal?: boolean;
}

interface Draft {
	date: string;
	payee: string;
	note: string;
	flag: string;
	postings: DraftPosting[];
	details: [string, string][];
	matchText: string[];
	/** Set on dividends and withholding tax, which are merged per (date, payee, kind). */
	merge?: { kind: string; isDividend: boolean };
	reversalDates: string[];
}

function posting(account: string, amount: Dec, currency: string, reversal?: boolean): DraftPosting {
	return { account, amount, currency, reversal };
}

function cashAccount(env: CashEnv, currency: string): string {
	return fillTemplate(env.config.cashAccount, { currency });
}

/** The description of a dividend row without the leading `SYMBOL(ISIN) CASH DIVIDEND `. */
export function groomDividendDescription(text: string | undefined): string {
	if (!text) return '';
	const parts = text.split(' ');
	const at = parts.indexOf('DIVIDEND');
	return at < 0 ? text : parts.slice(at + 1).join(' ');
}

function baseDraft(row: CashTransactionRow, payee: string, note: string): Draft {
	const details: [string, string][] = [];
	if (row.description) details.push(['IB description', row.description]);
	if (row.dateTime && isoDate(row.dateTime) !== isoDate(row.reportDate)) {
		details.push(['Value date', isoDate(row.dateTime)]);
	}
	return {
		date: isoDate(row.reportDate),
		payee,
		note,
		flag: '*',
		postings: [],
		details,
		matchText: [payee, note].filter(Boolean),
		reversalDates: []
	};
}

function deposit(row: CashTransactionRow, env: CashEnv): Draft {
	const amount = Dec.parse(row.amount);
	const draft = baseDraft(row, `IB ${row.currency} Deposit`, '');
	let counter = env.config.transferAccounts[row.currency];
	if (!counter) {
		counter = PLACEHOLDER_ACCOUNT;
		draft.flag = '!';
		env.warnings.push(
			`No transfer account is configured for ${row.currency}; the deposit of ${row.amount} on ${draft.date} is left on the placeholder account.`
		);
	}
	draft.postings = [
		posting(cashAccount(env, row.currency), amount, row.currency),
		posting(counter, amount.neg(), row.currency)
	];
	return draft;
}

function brokerInterest(row: CashTransactionRow, env: CashEnv): Draft {
	const amount = Dec.parse(row.amount);
	const draft = baseDraft(row, 'Interactive Brokers', row.description ?? '');
	// Interest received and paid are booked on the same account.
	draft.postings = [
		posting(cashAccount(env, row.currency), amount, row.currency),
		posting(
			fillTemplate(env.config.brokerInterestAccount, { currency: row.currency }),
			amount.neg(),
			row.currency
		)
	];
	return draft;
}

function fee(row: CashTransactionRow, env: CashEnv): Draft {
	const amount = Dec.parse(row.amount);
	const text = row.description ?? '';
	const month = /\w{3} \d{4}/.exec(text)?.[0];
	const note = month ? `Fee ${row.currency} ${month}` : text;
	const draft = baseDraft(row, 'IB Commission Adjustment', note);
	draft.postings = [
		posting(
			fillTemplate(env.config.feesAccount, { currency: row.currency }),
			amount.neg(),
			row.currency
		),
		posting(cashAccount(env, row.currency), amount, row.currency)
	];
	return draft;
}

function distribution(row: CashTransactionRow, env: CashEnv): Draft {
	const amount = Dec.parse(row.amount);
	const isTax = row.type === TYPE.withholdingTax;

	let symbol = env.symbols.resolve(row);
	const unknown = symbol === undefined;
	if (unknown) {
		symbol = row.symbol ?? row.isin ?? 'UNKNOWN';
		env.warnings.push(
			`Unknown symbol ${row.symbol ?? '?'} (ISIN ${row.isin ?? '?'}) on ${row.reportDate}: add the ISIN to the commodity in the book, or to the importer's symbols.`
		);
	}
	const bookSymbol = symbol as string;
	const draft = baseDraft(
		row,
		(env.config.distributionPayee ?? '{symbol} distribution').replace('{symbol}', bookSymbol),
		groomDividendDescription(row.description)
	);
	if (unknown) draft.flag = '!';
	if (row.isin) draft.details.push(['ISIN', row.isin]);
	draft.matchText.unshift(bookSymbol);

	const isInterest = env.distributionKinds?.[bookSymbol] === 'interest';
	if (isInterest && !isTax && !env.config.interestAccount) {
		const message = `${bookSymbol} is tagged distribution: interest, but the config has no interest account; booked on the distribution account.`;
		if (!env.warnings.includes(message)) env.warnings.push(message);
	}
	const incomeTemplate =
		isInterest && env.config.interestAccount
			? env.config.interestAccount
			: env.config.distributionAccount;
	const account = isTax
		? fillTemplate(env.config.withholdingTaxAccount, {
				currency: row.currency,
				symbol: accountSymbol(bookSymbol)
			})
		: fillTemplate(incomeTemplate, {
				currency: row.currency,
				symbol: accountSymbol(bookSymbol)
			});

	// Tax is merged with regular dividends, so the kind of a tax row is "Dividends".
	// A tax refund (positive amount) is the base of a merged group, as a dividend would be.
	const reversal = isTax && amount.sign > 0;
	draft.merge = {
		kind: isTax ? TYPE.dividend : row.type,
		isDividend: !isTax || reversal
	};
	draft.postings = [
		posting(cashAccount(env, row.currency), amount, row.currency),
		posting(account, amount.neg(), row.currency, reversal)
	];
	if (reversal && row.dateTime) draft.reversalDates.push(isoDate(row.dateTime));
	return draft;
}

/**
 * Merges dividends with their withholding tax, per (date, payee, kind). A group is merged only if
 * it has a dividend (or a tax refund) to merge into. Postings of the same account are summed,
 * except tax reversals, which stay visible as separate postings.
 */
function mergeDistributions(drafts: Draft[]): Draft[] {
	const groups = new Map<string, Draft[]>();
	for (const d of drafts) {
		if (!d.merge) continue;
		const key = JSON.stringify([d.date, d.payee, d.merge.kind]);
		groups.set(key, [...(groups.get(key) ?? []), d]);
	}

	const removed = new Set<Draft>();
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		const base = group.find((d) => d.merge!.isDividend);
		if (!base) continue;

		for (const other of group) {
			if (other === base) continue;
			base.postings.push(...other.postings);
			base.reversalDates.push(...other.reversalDates);
			for (const detail of other.details) {
				if (!base.details.some(([k, v]) => k === detail[0] && v === detail[1])) {
					base.details.push(detail);
				}
			}
			removed.add(other);
		}

		const summed = new Map<string, DraftPosting>();
		const reversals: DraftPosting[] = [];
		for (const p of base.postings) {
			if (p.reversal) {
				reversals.push(p);
				continue;
			}
			const key = JSON.stringify([p.account, p.currency]);
			const existing = summed.get(key);
			if (existing) existing.amount = existing.amount.add(p.amount);
			else summed.set(key, { ...p });
		}
		base.postings = [...summed.values(), ...reversals];
	}
	return drafts.filter((d) => !removed.has(d));
}

function toImported(draft: Draft): ImportedXact {
	const xact = new Xact();
	xact.date = draft.date;
	xact.payee = draft.payee;
	xact.note = draft.note;
	xact.flag = draft.flag;
	const dates = [...new Set(draft.reversalDates)];
	if (dates.length > 0) xact.meta['tax-reversal-date'] = dates.join(', ');
	xact.postings = draft.postings.map((p) => {
		const posting = new Posting();
		posting.account = p.account;
		posting.amount = p.amount.toNumber();
		posting.currency = p.currency;
		return posting;
	});
	return { xact, details: draft.details, matchText: draft.matchText };
}

/** Transactions for all cash rows of the statement. */
export function cashTransactions(rows: CashTransactionRow[], env: CashEnv): ImportedXact[] {
	const drafts: Draft[] = [];
	for (const row of rows) {
		switch (row.type) {
			case TYPE.deposit:
				drafts.push(deposit(row, env));
				break;
			case TYPE.interestReceived:
			case TYPE.interestPaid:
				drafts.push(brokerInterest(row, env));
				break;
			case TYPE.fees:
			case TYPE.commissionAdjustment:
				drafts.push(fee(row, env));
				break;
			case TYPE.dividend:
			case TYPE.paymentInLieu:
			case TYPE.withholdingTax:
				drafts.push(distribution(row, env));
				break;
			default:
				env.warnings.push(
					`Cash transaction type "${row.type}" is not supported yet; skipped ${row.amount} ${row.currency} on ${row.reportDate}.`
				);
		}
	}
	return mergeDistributions(drafts).map(toImported);
}
