import { describe, expect, it } from 'vitest';
import { balances } from '../../src/lib/importers/ibkr/balances';
import type { IbkrConfig } from '../../src/lib/importers/ibkr/config';
import { parseFlexQuery } from '../../src/lib/importers/ibkr/flexXml';
import { SymbolMap } from '../../src/lib/importers/ibkr/symbols';
import { canonicalize, readExpected, readFixture } from '../helpers/beancountExpected';

const CONFIG: IbkrConfig = {
	cashAccount: 'Assets:Investments:IB:Cash-{currency}',
	stockAccount: 'Assets:Investments:IB:Stocks:{symbol}',
	distributionAccount: 'Income:Investments:Dividend:IB:{symbol}',
	capitalGainAccount: 'Income:Investment:Capital-Gains:IB',
	brokerInterestAccount: 'Income:Investments:Interest:IB:Cash',
	feesAccount: 'Expenses:Financial:IB',
	withholdingTaxAccount: 'Expenses:Investments:IB:WithholdingTax',
	transferAccounts: {}
};

function run(xml: string, known = true) {
	const warnings: string[] = [];
	const [statement] = parseFlexQuery(xml);
	const symbols = new SymbolMap(
		known
			? [
					['OPI', 'US67623C1099'],
					['VAP.AX', 'AU000000VAP7']
				]
			: []
	);
	const imported = balances(statement, { config: CONFIG, symbols, warnings });
	return { imported, warnings, canonical: canonicalize(imported.map((i) => i.xact)) };
}

describe('IBKR balance assertions', () => {
	for (const name of ['cash-balances', 'stock-balances']) {
		it(name, () => {
			const { canonical, warnings } = run(readFixture(`${name}.xml`));
			expect(canonical).toEqual(readExpected(`${name}.xml`));
			expect(warnings).toEqual([]);
		});
	}

	it('flags a position of an unknown symbol and falls back to the ticker', () => {
		const { imported, warnings } = run(readFixture('stock-balances.xml'), false);
		const stock = imported.filter((i) => i.xact.balanceAssertion?.currency === 'OPI');
		expect(stock).toHaveLength(1);
		expect(stock[0].xact.flag).toBe('!');
		expect(warnings).toHaveLength(2);
	});
});
