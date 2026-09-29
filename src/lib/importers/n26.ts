import { Posting, Xact } from '$lib/data/model';
import { PLACEHOLDER_ACCOUNT } from '$lib/utils/xactUtils';
import { parseCsv } from './csv';
import type { Importer } from './types';

const HEADER_START = '"Booking Date","Value Date","Partner Name"';
const ISIN_RE = /\bISIN\s+([A-Z]{2}[A-Z0-9]{9}\d)\b/;
const DIVIDEND_RE = /cash dividend/i;

/** JSON-serializable, so it can live in Settings or OPFS. Regexes are strings, matched case-insensitively. */
export interface N26Config {
	/** The N26 asset account. */
	account: string;
	/** Account currency. Default EUR. */
	currency?: string;
	/** Account for uncategorized incoming payments. Default is the placeholder account. */
	defaultIncome?: string;
	/** Account for uncategorized outgoing payments. Default is the placeholder account. */
	defaultExpense?: string;
	/** Template for distributions; `{symbol}` is resolved through `isinToSymbol`, or the ISIN itself. */
	dividendAccount?: string;
	/** Payee template for distributions. Default `{symbol} distribution`. */
	dividendPayee?: string;
	/** ISIN -> commodity symbol. Overrides (and extends) the `isin` metadata found in the book. */
	isinToSymbol?: Record<string, string>;
	/** Ordered [regex, payee]; first match on the partner name wins. */
	payeeRenames?: [string, string][];
	/** Ordered [regex, account]; matched against the partner name, then the payment reference. */
	categories?: [string, string][];
}

function compile(rules: [string, string][] = []): [RegExp, string][] {
	return rules.map(([pattern, value]) => [new RegExp(pattern, 'i'), value]);
}

function posting(account: string, amount: number, currency: string): Posting {
	const p = new Posting();
	p.account = account;
	p.amount = amount;
	p.currency = currency;
	return p;
}

export const n26Importer: Importer<N26Config> = {
	id: 'n26',
	name: 'N26 (CSV)',
	defaultConfig: {
		account: 'Assets:Bank-Accounts:N26',
		currency: 'EUR',
		dividendAccount: 'Income:Dividends:{symbol}',
		dividendPayee: '{symbol} distribution',
		isinToSymbol: {},
		payeeRenames: [],
		categories: []
	},

	account: (config) => config.account,

	identify(text) {
		return text.replace(/^﻿/, '').startsWith(HEADER_START);
	},

	extract(text, config, ctx = {}) {
		const currency = config.currency ?? 'EUR';
		const renames = compile(config.payeeRenames);
		const categories = compile(config.categories);
		const isinToSymbol = { ...ctx.isinToSymbol, ...config.isinToSymbol };

		return parseCsv(text).map((row) => {
			const amount = Number(row['Amount (EUR)']);
			const reference = row['Payment Reference'].trim();
			const partner = row['Partner Name'].trim();

			const xact = new Xact();
			xact.date = row['Booking Date'];
			// Bank dates lag; keep the value date when it differs.
			if (row['Value Date'] !== row['Booking Date']) xact.meta.value_date = row['Value Date'];

			const origCurrency = row['Original Currency'];
			if (origCurrency && origCurrency !== currency) {
				xact.meta.original_amount = `${row['Original Amount']} ${origCurrency}`;
				xact.meta.exchange_rate = row['Exchange Rate'];
			}

			const isin = DIVIDEND_RE.test(reference) ? ISIN_RE.exec(reference)?.[1] : undefined;
			let counterAccount: string;
			if (isin) {
				const symbol = isinToSymbol[isin] ?? isin;
				xact.payee = (config.dividendPayee ?? '{symbol} distribution').replace('{symbol}', symbol);
				xact.note = '';
				xact.meta.isin = isin;
				counterAccount = (config.dividendAccount ?? 'Income:Dividends:{symbol}').replace(
					'{symbol}',
					symbol
				);
			} else {
				xact.payee = renames.find(([re]) => re.test(partner))?.[1] ?? partner;
				xact.note = reference;
				counterAccount =
					categories.find(([re]) => re.test(partner) || (reference && re.test(reference)))?.[1] ??
					(amount < 0
						? (config.defaultExpense ?? PLACEHOLDER_ACCOUNT)
						: (config.defaultIncome ?? PLACEHOLDER_ACCOUNT));
			}

			xact.postings = [
				posting(config.account, amount, currency),
				posting(counterAccount, -amount, currency)
			];
			return xact;
		});
	}
};
