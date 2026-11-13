import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Posting, Xact } from '../../src/lib/data/model';
import {
	canonicalize,
	IBKR_FIXTURES,
	parseExpected,
	readExpected,
	readFixture
} from '../helpers/beancountExpected';

describe('IBKR golden-file harness', () => {
	const inputs = readdirSync(IBKR_FIXTURES).filter((f) => f.endsWith('.xml'));

	it('has an expected file for every input', () => {
		expect(inputs.length).toBe(20);
		for (const name of inputs) expect(() => readExpected(name), name).not.toThrow();
	});

	it('reads the placeholder account only', () => {
		for (const name of inputs) {
			expect(readFixture(name), name).not.toMatch(/accountId="(?!A0001111")/);
		}
	});

	it('parses a dividend with tax, cost, price and posting metadata', () => {
		const parsed = parseExpected(`
;; comment
2025-02-20 * "OPI distribution" "note"
  Assets:Cash-USD           0.44 USD
  Income:Dividend:OPI      -0.52 USD
    date: 2024-05-15
  Assets:Stocks:VHY-AX      12 VHY.AX {71.99 AUD, 2025-03-17}
  Assets:Cash-EUR  -77.12 EUR @ 1.72079 AUD
  Income:CapGain

2025-05-22 balance Assets:Cash-AUD   100 AUD
`);
		expect(parsed).toEqual([
			'2025-02-20 * "OPI distribution" "note"\n' +
				'  Assets:Cash-USD 0.44 USD\n' +
				'  Income:Dividend:OPI -0.52 USD\n' +
				'    date: 2024-05-15\n' +
				'  Assets:Stocks:VHY-AX 12 VHY.AX {71.99 AUD, 2025-03-17}\n' +
				'  Assets:Cash-EUR -77.12 EUR @ 1.72079 AUD\n' +
				'  Income:CapGain',
			'2025-05-22 balance Assets:Cash-AUD 100 AUD'
		]);
	});

	it('canonicalizes Xacts to the same form as the expected text', () => {
		const post = (account: string, amount?: number, currency = 'USD') => {
			const p = new Posting();
			p.account = account;
			p.amount = amount;
			p.currency = currency;
			return p;
		};
		const tx = new Xact();
		tx.date = '2025-02-20';
		tx.payee = 'OPI distribution';
		tx.note = 'note';
		const stock = post('Assets:Stocks:VHY-AX', 12, 'VHY.AX');
		stock.costAmount = 71.99;
		stock.costCurrency = 'AUD';
		stock.costDate = '2025-03-17';
		tx.postings = [post('Assets:Cash-USD', 0.44), post('Income:Dividend:OPI', -0.52), stock];

		const bal = new Xact();
		bal.date = '2025-05-22';
		bal.balanceAssertion = { account: 'Assets:Cash-AUD', amount: 100, currency: 'AUD' };

		expect(canonicalize([bal, tx])).toEqual(
			parseExpected(`
2025-02-20 * "OPI distribution" "note"
  Assets:Cash-USD     0.44 USD
  Income:Dividend:OPI -0.52 USD
  Assets:Stocks:VHY-AX 12 VHY.AX {71.99 AUD, 2025-03-17}
2025-05-22 balance Assets:Cash-AUD 100 AUD
`)
		);
	});
});
