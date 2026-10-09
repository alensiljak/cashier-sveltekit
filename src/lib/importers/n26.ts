import { Posting, Xact } from '#lib/data/model';
import { PLACEHOLDER_ACCOUNT } from '#lib/utils/xactUtils';
import { parseCsv } from './csv';
import { allRules, compileRules, describeRule, evaluateRules, type RuleConfig } from './rules';
import type { ImportedXact, Importer } from './types';

const HEADER_START = '"Booking Date","Value Date","Partner Name"';
const ISIN_RE = /\bISIN\s+([A-Z]{2}[A-Z0-9]{9}\d)\b/;
const DIVIDEND_RE = /cash dividend/i;

/** JSON-serializable, so it can live in Settings or OPFS. */
export interface N26Config extends RuleConfig {
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
	usesRules: true,
	defaultConfig: {
		account: 'Assets:Bank-Accounts:N26',
		currency: 'EUR',
		dividendAccount: 'Income:Dividends:{symbol}',
		dividendPayee: '{symbol} distribution',
		isinToSymbol: {},
		rules: []
	},
	account: (config) => config.account,

	identify(text) {
		return text.replace(/^﻿/, '').startsWith(HEADER_START);
	},

	extract(text, config, ctx = {}) {
		const currency = config.currency ?? 'EUR';
		const rules = ctx.applyRules === false ? [] : compileRules(allRules(config));
		const isinToSymbol = { ...ctx.isinToSymbol, ...config.isinToSymbol };

		return parseCsv(text).map((row): ImportedXact => {
			const amount = Number(row['Amount (EUR)']);
			const reference = row['Payment Reference'].trim();
			const partner = row['Partner Name'].trim();
			const matchText = [partner, reference].filter(Boolean);

			const xact = new Xact();
			xact.date = row['Booking Date'];

			const details: [string, string][] = [['Original payee', partner]];
			if (reference) details.push(['Reference', reference]);
			if (row['Value Date'] !== row['Booking Date'])
				details.push(['Value date', row['Value Date']]);
			const origCurrency = row['Original Currency'];
			if (origCurrency && origCurrency !== currency) {
				details.push(['Original amount', `${row['Original Amount']} ${origCurrency}`]);
				details.push(['Exchange rate', row['Exchange Rate']]);
			}

			const isin = DIVIDEND_RE.test(reference) ? ISIN_RE.exec(reference)?.[1] : undefined;
			let defaultPayee = partner;
			let defaultAccount =
				amount < 0
					? (config.defaultExpense ?? PLACEHOLDER_ACCOUNT)
					: (config.defaultIncome ?? PLACEHOLDER_ACCOUNT);
			if (isin) {
				const symbol = isinToSymbol[isin] ?? isin;
				defaultPayee = (config.dividendPayee ?? '{symbol} distribution').replace(
					'{symbol}',
					symbol
				);
				defaultAccount = (config.dividendAccount ?? 'Income:Dividends:{symbol}').replace(
					'{symbol}',
					symbol
				);
				xact.note = '';
				// Reports link distributions to a security by this tag, so unlike other
				// extras it is saved on the transaction.
				xact.meta.isin = isin;
				details.push(['ISIN', isin]);
				// The symbol first, so a new rule is prefilled with something readable.
				matchText.unshift(symbol);
			} else {
				xact.note = reference;
			}

			// Rules apply to distributions too, e.g. to send a bond fund to an interest account.
			const outcome = evaluateRules(rules, matchText);
			xact.payee = outcome.payee ?? defaultPayee;
			const counterAccount = outcome.account ?? defaultAccount;
			// Still on the placeholder account: mark it for review.
			xact.flag = counterAccount === PLACEHOLDER_ACCOUNT ? '!' : '*';

			const appliedRules: number[] = [];
			if (outcome.payeeRule) {
				details.push(['Payee rule', describeRule(outcome.payeeRule, outcome.payee!)]);
				appliedRules.push(outcome.payeeRule.index);
			}
			if (outcome.accountRule) {
				details.push(['Account rule', describeRule(outcome.accountRule, outcome.account!)]);
				if (!appliedRules.includes(outcome.accountRule.index)) {
					appliedRules.push(outcome.accountRule.index);
				}
			}

			// The receiving side (the positive posting) goes first.
			const bank = posting(config.account, amount, currency);
			const counter = posting(counterAccount, -amount, currency);
			xact.postings = amount < 0 ? [counter, bank] : [bank, counter];
			return { xact, details, matchText, appliedRules };
		});
	}
};
