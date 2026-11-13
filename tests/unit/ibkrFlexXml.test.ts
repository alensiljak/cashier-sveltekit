import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	addDays,
	isFlexQuery,
	isoDate,
	parseFlexQuery
} from '../../src/lib/importers/ibkr/flexXml';
import { IBKR_FIXTURES, readFixture } from '../helpers/beancountExpected';

const count = (text: string, tag: string) => text.split(`<${tag} `).length - 1;

describe('Flex Query reader', () => {
	const inputs = readdirSync(IBKR_FIXTURES).filter((f) => f.endsWith('.xml'));

	it('reads every fixture, keeping every record', () => {
		for (const name of inputs) {
			const text = readFixture(name);
			expect(isFlexQuery(text), name).toBe(true);
			const [s, ...rest] = parseFlexQuery(text);
			expect(rest, name).toHaveLength(0);
			expect(s.cashTransactions.length, name).toBe(count(text, 'CashTransaction'));
			expect(s.openPositions.length, name).toBe(count(text, 'OpenPosition'));
			expect(s.cashReport.length, name).toBe(count(text, 'CashReportCurrency'));
			expect(s.corporateActions.length, name).toBe(count(text, 'CorporateAction'));
			expect(s.trades.length, name).toBe(count(text, 'Trade'));
			expect(
				s.trades.reduce((n, t) => n + t.lots.length, 0),
				name
			).toBe(count(text, 'Lot'));
		}
	});

	it('reads a dividend and keeps amounts as text', () => {
		const [s] = parseFlexQuery(readFixture('div-interest.xml'));
		expect(s).toMatchObject({
			accountId: 'A0001111',
			fromDate: '2025-01-22',
			toDate: '2025-05-21',
			whenGenerated: '2025-05-22 20:41:57'
		});
		expect(s.cashTransactions[0]).toMatchObject({
			type: 'Dividends',
			currency: 'GBP',
			symbol: 'VGOV',
			isin: 'IE00B42WWV65',
			amount: '11.24',
			reportDate: '2025-02-26'
		});
	});

	it('attaches lots to the trade before them and drops empty attributes', () => {
		const [s] = parseFlexQuery(readFixture('forex-mix.xml'));
		const fractional = s.trades.find((t) => t.symbol === 'TCF.RTS0')!;
		expect(fractional.lots).toHaveLength(1);
		expect(fractional.lots[0].quantity).toBe('0.3333');
		// `transactionType=""` on the lot, `taxes` absent on the trade.
		expect(fractional.taxes).toBeUndefined();
		const fx = s.trades.find((t) => t.symbol === 'EUR.USD')!;
		expect(fx.isin).toBeUndefined();
		expect(fx.lots).toHaveLength(0);
	});

	it('reads cash report and positions', () => {
		const [s] = parseFlexQuery(readFixture('stock-balances.xml'));
		expect(s.cashReport.map((r) => [r.currency, r.endingCash, r.toDate])).toEqual([
			['BASE_SUMMARY', '500', '2025-05-21'],
			['AUD', '100', '2025-05-21']
		]);
		expect(s.openPositions.map((p) => [p.symbol, p.position])).toEqual([
			['OPI', '10'],
			['VAP', '20']
		]);
	});

	it('rejects input that is not a Flex Query report', () => {
		expect(isFlexQuery('a,b,c')).toBe(false);
		expect(() => parseFlexQuery('<a><b></a>')).toThrow('not valid XML');
		expect(() => parseFlexQuery('<Other/>')).toThrow('Not a Flex Query report');
	});

	it('names the missing attribute', () => {
		const xml = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="A" fromDate="2025-01-01" toDate="2025-01-02" whenGenerated="2025-01-03 00:00:00"><CashTransactions><CashTransaction currency="USD" type="Dividends" reportDate="2025-01-01"/></CashTransactions></FlexStatement></FlexStatements></FlexQueryResponse>`;
		expect(() => parseFlexQuery(xml)).toThrow('missing the "amount" attribute');
	});
});

describe('Flex dates', () => {
	it('takes the date part of a date-time', () => {
		expect(isoDate('2025-02-27 12:20:00')).toBe('2025-02-27');
		expect(isoDate('2025-02-27')).toBe('2025-02-27');
	});

	it('rejects other formats, telling the user how to fix the query', () => {
		expect(() => isoDate('20250227;122000')).toThrow('yyyy-MM-dd');
		expect(() => isoDate('2025-13-45')).toThrow('yyyy-MM-dd');
	});

	it('adds days across month and year ends', () => {
		expect(addDays('2025-05-21', 1)).toBe('2025-05-22');
		expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
		expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
	});
});
