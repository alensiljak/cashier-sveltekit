import type { ImportedXact, Importer } from '../types';
import { fillTemplate, type IbkrConfig } from './config';
import { cashTransactions } from './cashTransactions';
import { isFlexQuery, parseFlexQuery } from './flexXml';
import { balances } from './balances';
import { trades } from './trades';
import { SymbolMap, type SymbolEntry } from './symbols';

/**
 * Interactive Brokers Flex Query (XML). Work in progress: so far only cash transactions are
 * imported (phase 4). Trades, balance assertions and dedup follow.
 */
export const ibkrImporter: Importer<IbkrConfig> = {
	id: 'ibkr',
	name: 'Interactive Brokers (Flex XML)',
	defaultConfig: {
		cashAccount: 'Assets:Investments:IB:Cash-{currency}',
		stockAccount: 'Assets:Investments:IB:Stocks:{symbol}',
		distributionAccount: 'Income:Investments:Dividend:IB:{symbol}',
		distributionPayee: '{symbol} distribution',
		capitalGainAccount: 'Income:Investments:CapitalGain:IB',
		brokerInterestAccount: 'Income:Investments:Interest:IB',
		feesAccount: 'Expenses:Investments:IB:Fees',
		withholdingTaxAccount: 'Expenses:Investments:IB:WithholdingTax',
		transferAccounts: { EUR: 'Assets:Bank-Accounts:N26' },
		symbols: []
	},

	// Used to look up recorded transactions; the cash account of the first transfer currency.
	account(config) {
		const currency = Object.keys(config.transferAccounts ?? {})[0] ?? 'EUR';
		return fillTemplate(config.cashAccount, { currency });
	},

	identify: isFlexQuery,

	extract(text, config, ctx = {}) {
		const warnings = ctx.warnings ?? [];
		const entries: SymbolEntry[] = [
			...(ctx.symbolIsins ?? []).map(([symbol, isin]): SymbolEntry => [symbol, isin]),
			...(config.symbols ?? [])
		];
		const symbols = new SymbolMap(entries);

		const result: ImportedXact[] = [];
		for (const statement of parseFlexQuery(text)) {
			result.push(...cashTransactions(statement.cashTransactions, { config, symbols, warnings }));
			result.push(...trades(statement.trades, { config, symbols, warnings }));
			result.push(...balances(statement, { config, symbols, warnings }));
			if (statement.corporateActions.length > 0)
				warnings.push(
					`${statement.corporateActions.length} corporate actions not imported (not supported).`
				);
		}
		return result;
	}
};
