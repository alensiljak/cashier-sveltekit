import type { SymbolEntry } from './symbols';

/**
 * JSON-serializable, so it can live in Settings or OPFS.
 *
 * Account templates may contain `{currency}` and `{symbol}` (the book symbol, with `.` and `_`
 * written as `-`).
 */
export interface IbkrConfig {
	/** Cash in one currency, e.g. `Assets:Investments:IB:Cash-{currency}`. */
	cashAccount: string;
	/** Holdings of one security, e.g. `Assets:Investments:IB:Stocks:{symbol}`. */
	stockAccount: string;
	/** Dividends and fund distributions of any kind, e.g. `Income:Investments:Dividend:IB:{symbol}`. */
	distributionAccount: string;
	/** Payee template for distributions. Default `{symbol} distribution`. */
	distributionPayee?: string;
	/** Realized gains on sales. */
	capitalGainAccount: string;
	/** Interest the broker pays or charges on cash balances. */
	brokerInterestAccount: string;
	/** Commissions and fees. */
	feesAccount: string;
	/** Tax withheld on distributions. */
	withholdingTaxAccount: string;
	/** Where deposits come from / withdrawals go to, by currency: `{ EUR: 'Assets:Bank:EUR' }`. */
	transferAccounts: Record<string, string>;
	/**
	 * Symbol overrides and additions to what the book's `isin` metadata provides:
	 * `[ticker, isin]` or `[ticker, bookSymbol, isin]`.
	 */
	symbols?: SymbolEntry[];
}

/** Fills `{currency}` and `{symbol}` in an account template. */
export function fillTemplate(template: string, values: { currency?: string; symbol?: string }) {
	let result = template;
	if (values.currency !== undefined) result = result.replaceAll('{currency}', values.currency);
	if (values.symbol !== undefined) result = result.replaceAll('{symbol}', values.symbol);
	return result;
}
