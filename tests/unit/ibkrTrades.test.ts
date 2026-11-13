import { describe, expect, it } from 'vitest';
import type { IbkrConfig } from '../../src/lib/importers/ibkr/config';
import { parseFlexQuery } from '../../src/lib/importers/ibkr/flexXml';
import { SymbolMap, type SymbolEntry } from '../../src/lib/importers/ibkr/symbols';
import { trades } from '../../src/lib/importers/ibkr/trades';
import { canonicalize, readExpected, readFixture } from '../helpers/beancountExpected';

const BOOK: SymbolEntry[] = [
	['PFXF', 'US92189F4292'],
	['VACF.AX', 'AU00000VACF9'],
	['VHY.AX', 'AU000000VHY4']
];

const CONFIG: IbkrConfig = {
	cashAccount: 'Assets:Investments:IB:Cash-{currency}',
	stockAccount: 'Assets:Investments:IB:Stocks:{symbol}',
	distributionAccount: 'Income:Investments:Dividend:IB:{currency}:{symbol}',
	capitalGainAccount: 'Income:Investment:Capital-Gains:IB',
	brokerInterestAccount: 'Income:Investments:Interest:IB:Cash',
	feesAccount: 'Expenses:Financial:IB',
	withholdingTaxAccount: 'Expenses:Investments:IB:WithholdingTax',
	transferAccounts: {}
};

function run(xml: string) {
	const warnings: string[] = [];
	const [statement] = parseFlexQuery(xml);
	const imported = trades(statement.trades, {
		config: CONFIG,
		symbols: new SymbolMap(BOOK),
		warnings
	});
	return { imported, warnings, canonical: canonicalize(imported.map((i) => i.xact)) };
}

describe('IBKR trades, against the fixtures', () => {
	for (const name of ['stock-trades', 'stock-trades-merge', 'forex', 'forex-combine']) {
		it(name, () => {
			const { canonical, warnings } = run(readFixture(`${name}.xml`));
			expect(canonical).toEqual(readExpected(`${name}.xml`));
			expect(warnings).toEqual([]);
		});
	}

	it('forex-mix: keeps the conversions, warns about the rights-issue trade', () => {
		const { canonical, warnings } = run(readFixture('forex-mix.xml'));
		expect(canonical).toEqual(readExpected('forex-mix.xml'));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('TCF.RTS0');
	});
});

describe('IBKR trades, other cases', () => {
	const statement = (rows: string) =>
		`<FlexQueryResponse><FlexStatements><FlexStatement accountId="A0001111" fromDate="2025-01-01" toDate="2025-01-31" whenGenerated="2025-02-01 00:00:00"><Trades>${rows}</Trades></FlexStatement></FlexStatements></FlexQueryResponse>`;

	it('warns about a sale and creates nothing', () => {
		const { imported, warnings } = run(
			statement(
				`<Trade currency="USD" symbol="PFXF" isin="US92189F4292" dateTime="2025-06-06 10:00:00" transactionType="ExchTrade" quantity="-4" tradePrice="17" netCash="67" buySell="SELL" openCloseIndicator="C" />`
			)
		);
		expect(imported).toEqual([]);
		expect(warnings).toHaveLength(1);
	});

	it('warns about a forex trade with a commission', () => {
		const { imported, warnings } = run(
			statement(
				`<Trade currency="USD" symbol="EUR.USD" dateTime="2025-06-06 10:00:00" reportDate="2025-06-06" transactionType="ExchTrade" quantity="-100" tradePrice="1.1" proceeds="110" ibCommission="-2" ibCommissionCurrency="USD" buySell="SELL" />`
			)
		);
		expect(imported).toEqual([]);
		expect(warnings[0]).toContain('commission');
	});

	it('flags a buy of an unknown symbol and falls back to the ticker', () => {
		const { imported, warnings } = run(
			statement(
				`<Trade currency="USD" symbol="NEW" isin="US0000000001" dateTime="2025-06-06 10:00:00" transactionType="ExchTrade" quantity="1" tradePrice="10" netCash="-10" buySell="BUY" openCloseIndicator="O" />`
			)
		);
		expect(imported[0].xact.flag).toBe('!');
		expect(imported[0].xact.payee).toBe('Buy NEW');
		expect(warnings).toHaveLength(1);
	});

	it('books fees in the commission currency when it differs from the trade currency', () => {
		const { canonical } = run(
			statement(
				`<Trade currency="USD" symbol="PFXF" isin="US92189F4292" dateTime="2025-06-06 10:00:00" transactionType="ExchTrade" quantity="1" tradePrice="10" netCash="-10.5" ibCommission="-0.5" ibCommissionCurrency="EUR" buySell="BUY" openCloseIndicator="O" />`
			)
		);
		expect(canonical[0]).toContain('Expenses:Financial:IB 0.5 EUR');
	});
});
