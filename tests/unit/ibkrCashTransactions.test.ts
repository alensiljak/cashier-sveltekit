import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_ACCOUNT } from '../../src/lib/utils/xactUtils';
import {
	cashTransactions,
	groomDividendDescription
} from '../../src/lib/importers/ibkr/cashTransactions';
import type { IbkrConfig } from '../../src/lib/importers/ibkr/config';
import { parseFlexQuery } from '../../src/lib/importers/ibkr/flexXml';
import { SymbolMap, type SymbolEntry } from '../../src/lib/importers/ibkr/symbols';
import { canonicalize, readExpected, readFixture } from '../helpers/beancountExpected';

/** The same book as the Python tests: [symbol, ISIN] pairs. */
const FUND_CODES: SymbolEntry[] = [
	['AMLP', 'US00162Q4525'],
	['DGSE.MI', 'IE00BQZJBM26'],
	['OPI', 'US67623C1099'],
	['PFXF', 'US92189F4292'],
	['SDIV', 'US37960A6698'],
	['SDIV.MI', 'IE00077FRP95'],
	['VACF.AX', 'AU00000VACF9'],
	['VAP.AX', 'AU000000VAP7'],
	['VGOV_F', 'IE00B42WWV65'],
	['VHY.AX', 'AU000000VHY4'],
	['WTED.DE', 'IE00BQZJBM26']
];

const CONFIG: IbkrConfig = {
	cashAccount: 'Assets:Investments:IB:Cash-{currency}',
	stockAccount: 'Assets:Investments:IB:Stocks:{symbol}',
	distributionAccount: 'Income:Investments:Dividend:IB:{currency}:{symbol}',
	distributionPayee: '{symbol} distribution',
	capitalGainAccount: 'Income:Investment:Capital-Gains:IB',
	brokerInterestAccount: 'Income:Investments:Interest:IB:Cash',
	feesAccount: 'Expenses:Financial:IB',
	withholdingTaxAccount: 'Expenses:Investments:IB:WithholdingTax',
	transferAccounts: { EUR: 'Assets:Bank-Accounts:EUR', AUD: 'Assets:Bank-Accounts:AUD' }
};

function run(xml: string, config = CONFIG) {
	const warnings: string[] = [];
	const [statement] = parseFlexQuery(xml);
	const imported = cashTransactions(statement.cashTransactions, {
		config,
		symbols: new SymbolMap(FUND_CODES),
		warnings
	});
	return { imported, warnings, canonical: canonicalize(imported.map((i) => i.xact)) };
}

/** Balance assertions are covered by their own tests; leave them out of the expected text. */
const withoutBalances = (lines: string[]) => lines.filter((l) => !l.includes(' balance '));

describe('IBKR cash transactions, against the fixtures', () => {
	const cases = [
		'deposits-withdrawals',
		'brk-int-recvd',
		'commission-adjustment',
		'div-tax',
		'div-interest',
		'simple-div',
		'simple-whtax',
		'tax-reversal',
		'tax-adjustment',
		'multiple-divs',
		'multiple-symbols-one-isin',
		'one-decimal'
	];

	for (const name of cases) {
		it(name, () => {
			const { canonical, warnings } = run(readFixture(`${name}.xml`));
			expect(canonical).toEqual(withoutBalances(readExpected(`${name}.xml`)));
			expect(warnings).toEqual([]);
		});
	}
});

describe('IBKR cash transactions, other cases', () => {
	const statement = (rows: string) =>
		`<FlexQueryResponse><FlexStatements><FlexStatement accountId="A0001111" fromDate="2025-01-01" toDate="2025-01-31" whenGenerated="2025-02-01 00:00:00"><CashTransactions>${rows}</CashTransactions></FlexStatement></FlexStatements></FlexQueryResponse>`;

	it('books a payment in lieu of dividends, and its reversal, separately', () => {
		// Real shape: the reversal comes on a later report date, so it is not merged with the payment.
		const { canonical, warnings } = run(
			statement(
				`<CashTransaction currency="EUR" symbol="OPI" isin="US67623C1099" reportDate="2025-01-15" dateTime="2025-01-16 11:20:00" amount="1.35" type="Payment In Lieu Of Dividends" description="OPI(US67623C1099) PAYMENT IN LIEU OF DIVIDEND (Mixed Income)" />` +
					`<CashTransaction currency="EUR" symbol="OPI" isin="US67623C1099" reportDate="2025-01-20" dateTime="2025-01-16 11:20:00" amount="-1.35" type="Payment In Lieu Of Dividends" description="OPI(US67623C1099) PAYMENT IN LIEU OF DIVIDEND - REVERSAL (Mixed Income)" />`
			)
		);
		expect(warnings).toEqual([]);
		expect(canonical).toEqual(
			[
				'2025-01-15 * "OPI distribution" "(Mixed Income)"\n  Assets:Investments:IB:Cash-EUR 1.35 EUR\n  Income:Investments:Dividend:IB:EUR:OPI -1.35 EUR',
				'2025-01-20 * "OPI distribution" "- REVERSAL (Mixed Income)"\n  Assets:Investments:IB:Cash-EUR -1.35 EUR\n  Income:Investments:Dividend:IB:EUR:OPI 1.35 EUR'
			].sort()
		);
	});

	it('does not merge withholding tax into a payment in lieu', () => {
		const { imported } = run(
			statement(
				`<CashTransaction currency="USD" symbol="OPI" isin="US67623C1099" reportDate="2025-01-15" amount="1" type="Payment In Lieu Of Dividends" />` +
					`<CashTransaction currency="USD" symbol="OPI" isin="US67623C1099" reportDate="2025-01-15" amount="-0.15" type="Withholding Tax" />`
			)
		);
		expect(imported).toHaveLength(2);
	});

	it('books broker interest paid on the same account as received', () => {
		const { canonical } = run(
			statement(
				`<CashTransaction currency="EUR" reportDate="2025-05-05" amount="-0.5" type="Broker Interest Paid" description="EUR DEBIT INT FOR APR-2025" />`
			)
		);
		expect(canonical).toEqual([
			'2025-05-05 * "Interactive Brokers" "EUR DEBIT INT FOR APR-2025"\n  Assets:Investments:IB:Cash-EUR -0.5 EUR\n  Income:Investments:Interest:IB:Cash 0.5 EUR'
		]);
	});

	it('names a fee by its month', () => {
		const { canonical } = run(
			statement(
				`<CashTransaction currency="EUR" reportDate="2025-05-05" amount="-1" type="Other Fees" description="Market data for Apr 2025" />`
			)
		);
		expect(canonical[0]).toContain('"IB Commission Adjustment" "Fee EUR Apr 2025"');
	});

	it('sums exactly, without floating-point noise', () => {
		const { imported } = run(
			statement(
				`<CashTransaction currency="USD" symbol="OPI" isin="US67623C1099" reportDate="2025-01-15" amount="0.3" type="Dividends" description="X CASH DIVIDEND USD 1 PER SHARE" />` +
					`<CashTransaction currency="USD" symbol="OPI" isin="US67623C1099" reportDate="2025-01-15" amount="-0.1" type="Withholding Tax" description="X CASH DIVIDEND USD 1 PER SHARE - US TAX" />` +
					`<CashTransaction currency="USD" symbol="OPI" isin="US67623C1099" reportDate="2025-01-15" amount="-0.2" type="Withholding Tax" description="X CASH DIVIDEND USD 1 PER SHARE - US TAX" />`
			)
		);
		expect(imported).toHaveLength(1);
		// cash: 0.3 - 0.1 - 0.2 is 5.55e-17 in floats
		expect(imported[0].xact.postings[0].amount).toBe(0);
	});

	it('warns and creates nothing for a row type it does not know', () => {
		const { imported, warnings } = run(
			statement(
				`<CashTransaction currency="USD" reportDate="2025-01-15" amount="5" type="Bond Interest Received" />`
			)
		);
		expect(imported).toHaveLength(0);
		expect(warnings).toEqual([
			'Cash transaction type "Bond Interest Received" is not supported yet; skipped 5 USD on 2025-01-15.'
		]);
	});

	it('falls back to the ticker for an unknown symbol, flags it and warns', () => {
		const { imported, warnings } = run(
			statement(
				`<CashTransaction currency="USD" symbol="ZZZ" isin="US0000000000" reportDate="2025-01-15" amount="2" type="Dividends" description="ZZZ(US0000000000) CASH DIVIDEND USD 1 PER SHARE" />`
			)
		);
		expect(imported[0].xact.payee).toBe('ZZZ distribution');
		expect(imported[0].xact.flag).toBe('!');
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('Unknown symbol ZZZ');
	});

	it('leaves a deposit on the placeholder account when no transfer account is configured', () => {
		const { imported, warnings } = run(
			statement(
				`<CashTransaction currency="GBP" reportDate="2025-01-15" amount="10" type="Deposits/Withdrawals" />`
			)
		);
		expect(imported[0].xact.flag).toBe('!');
		expect(imported[0].xact.postings[1].account).toBe(PLACEHOLDER_ACCOUNT);
		expect(warnings[0]).toContain('No transfer account is configured for GBP');
	});

	it('records where a row came from, for the review screen', () => {
		const { imported } = run(readFixture('simple-div.xml'));
		expect(imported[0].details).toEqual([
			['Value date', '2025-02-21'],
			['ISIN', 'US67623C1099']
		]);
		expect(imported[0].matchText).toEqual(['OPI', 'OPI distribution']);
	});
});

describe('groomDividendDescription', () => {
	it('drops everything up to DIVIDEND', () => {
		expect(
			groomDividendDescription('VGOV(IE00B42WWV65) CASH DIVIDEND GBP 0.05 PER SHARE (Mixed Income)')
		).toBe('GBP 0.05 PER SHARE (Mixed Income)');
		expect(groomDividendDescription('EXH9(X) PAYMENT IN LIEU OF DIVIDEND (Mixed Income)')).toBe(
			'(Mixed Income)'
		);
	});

	it('keeps text without DIVIDEND, and tolerates no text', () => {
		expect(groomDividendDescription('SOMETHING ELSE')).toBe('SOMETHING ELSE');
		expect(groomDividendDescription(undefined)).toBe('');
	});
});

describe('SymbolMap', () => {
	const map = new SymbolMap(FUND_CODES);

	it('resolves a ticker that matches the book symbol and ISIN', () => {
		expect(map.resolve({ symbol: 'OPI', isin: 'US67623C1099' })).toBe('OPI');
	});

	it('finds the book symbol by ISIN when the ticker differs', () => {
		expect(map.resolve({ symbol: 'VGOV', isin: 'IE00B42WWV65' })).toBe('VGOV_F');
	});

	it('picks the right listing of a dual-listed ISIN by the ticker', () => {
		expect(map.resolve({ symbol: 'DGSE', isin: 'IE00BQZJBM26' })).toBe('DGSE.MI');
		expect(map.resolve({ symbol: 'WTED', isin: 'IE00BQZJBM26' })).toBe('WTED.DE');
		expect(map.resolve({ symbol: 'NOPE', isin: 'IE00BQZJBM26' })).toBeUndefined();
	});

	it('does not trust a ticker whose ISIN differs (same ticker, two listings)', () => {
		expect(map.resolve({ symbol: 'SDIV', isin: 'US37960A6698' })).toBe('SDIV');
		expect(map.resolve({ symbol: 'SDIV', isin: 'IE00077FRP95' })).toBe('SDIV.MI');
	});

	it('returns undefined for an unknown ISIN or no ISIN', () => {
		expect(map.resolve({ symbol: 'ZZZ', isin: 'US0000000000' })).toBeUndefined();
		expect(map.resolve({ symbol: 'OPI' })).toBeUndefined();
	});

	it('supports a three-part entry and ignores a pair registered twice', () => {
		const m = new SymbolMap([
			...FUND_CODES,
			['VGOV', 'VGOV.F', 'IE00B42WWV65'],
			['OPI', 'US67623C1099']
		]);
		expect(m.resolve({ symbol: 'VGOV', isin: 'IE00B42WWV65' })).toBe('VGOV.F');
		expect(m.resolve({ symbol: 'OPI', isin: 'US67623C1099' })).toBe('OPI');
	});
});

describe('IBKR distributions tagged as interest', () => {
	const xml = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="A0001111" fromDate="2025-01-01" toDate="2025-01-31" whenGenerated="2025-02-01 00:00:00"><CashTransactions><CashTransaction currency="USD" symbol="OPI" isin="US67623C1099" reportDate="2025-01-15" amount="10" type="Dividends" description="OPI(US67623C1099) CASH DIVIDEND USD 0.1 PER SHARE" /><CashTransaction currency="USD" symbol="OPI" isin="US67623C1099" reportDate="2025-01-15" amount="-1.5" type="Withholding Tax" description="OPI(US67623C1099) CASH DIVIDEND USD 0.1 PER SHARE - US TAX" /></CashTransactions></FlexStatement></FlexStatements></FlexQueryResponse>`;
	const interestConfig = { ...CONFIG, interestAccount: 'Income:Interest:IB:{symbol}' };

	function accounts(config: IbkrConfig, kinds: Record<string, string>, warnings: string[] = []) {
		const [statement] = parseFlexQuery(xml);
		const [imported] = cashTransactions(statement.cashTransactions, {
			config,
			symbols: new SymbolMap(FUND_CODES),
			distributionKinds: kinds,
			warnings
		});
		return imported.xact.postings.map((p) => p.account);
	}

	it('books a tagged security on the interest account, tax stays on the tax account', () => {
		expect(accounts(interestConfig, { OPI: 'interest' })).toEqual([
			'Assets:Investments:IB:Cash-USD',
			'Income:Interest:IB:OPI',
			'Expenses:Investments:IB:WithholdingTax'
		]);
	});

	it('ignores other tags and untagged securities', () => {
		expect(accounts(interestConfig, { OPI: 'dividend' })).toContain(
			'Income:Investments:Dividend:IB:USD:OPI'
		);
		expect(accounts(interestConfig, {})).toContain('Income:Investments:Dividend:IB:USD:OPI');
	});

	it('falls back to the distribution account, once-warned, without an interest account', () => {
		const warnings: string[] = [];
		expect(accounts(CONFIG, { OPI: 'interest' }, warnings)).toContain(
			'Income:Investments:Dividend:IB:USD:OPI'
		);
		expect(warnings).toHaveLength(1);
	});
});
