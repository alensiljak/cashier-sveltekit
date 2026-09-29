import { describe, expect, it } from 'vitest';
import { findDuplicates } from '../../src/lib/importers/dedup';
import { identifyImporter } from '../../src/lib/importers';
import { n26Importer } from '../../src/lib/importers/n26';
import { Posting, Xact } from '../../src/lib/data/model';

const HEADER =
	'"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"';
const ACCOUNT = 'Assets:Bank:N26';

const csv = [
	HEADER,
	'2026-09-03,2026-09-02,"Lidl Oesterreich GmbH",,Presentment,,Card,-13.58,13.58,EUR,1',
	'2026-09-03,2026-09-03,"Equities Settlement account",DE36,"Credit Transfer","N26 cash dividend transaction - transaction ID x - ISIN IE00BZ163M45",Card,2.04,,,'
].join('\n');

function xact(date: string, amount: number, counter = 'Expenses:Food'): Xact {
	const x = new Xact();
	x.date = date;
	for (const [account, amt] of [
		[ACCOUNT, amount],
		[counter, -amount]
	] as const) {
		const p = new Posting();
		p.account = account;
		p.amount = amt;
		p.currency = 'EUR';
		x.postings.push(p);
	}
	return x;
}

describe('n26 importer', () => {
	it('identifies the file by its header', () => {
		expect(identifyImporter(csv)?.id).toBe('n26');
		expect(identifyImporter('a,b,c')).toBeUndefined();
	});

	it('extracts transactions, keeping the value date and handling distributions', () => {
		const [purchase, dividend] = n26Importer.extract(csv, {
			account: ACCOUNT,
			isinToSymbol: { IE00BZ163M45: 'VWRL' },
			payeeRenames: [['^lidl', 'Lidl']],
			categories: [['^lidl', 'Expenses:Groceries']]
		});
		expect(purchase.payee).toBe('Lidl');
		expect(purchase.meta.value_date).toBe('2026-09-02');
		expect(purchase.postings.map((p) => [p.account, p.amount])).toEqual([
			[ACCOUNT, -13.58],
			['Expenses:Groceries', 13.58]
		]);
		expect(dividend.payee).toBe('VWRL distribution');
		expect(dividend.meta.isin).toBe('IE00BZ163M45');
		expect(dividend.postings[1].account).toBe('Income:Dividends:VWRL');
	});
});

describe('findDuplicates', () => {
	it('matches within the date window regardless of the counter-account', () => {
		const [r] = findDuplicates([xact('2026-09-03', -13.58, 'Expenses:Uncategorized')], [xact('2026-09-01', -13.58)], ACCOUNT);
		expect(r.duplicateOf).toBeDefined();
	});

	it('does not match outside the window or on a different amount', () => {
		const existing = [xact('2026-08-20', -13.58), xact('2026-09-03', -13.59)];
		const [r] = findDuplicates([xact('2026-09-03', -13.58)], existing, ACCOUNT);
		expect(r.duplicateOf).toBeUndefined();
	});

	it('pairs by closest date, not by processing order', () => {
		// The 09-11 booking exists; the 09-09 one (earlier in the file) is new.
		const results = findDuplicates(
			[xact('2026-09-09', -7.15), xact('2026-09-11', -7.15)],
			[xact('2026-09-11', -7.15)],
			ACCOUNT
		);
		expect(results.map((r) => !!r.duplicateOf)).toEqual([false, true]);
	});

	it('takes the ISIN symbol from the book context', () => {
		const [, dividend] = n26Importer.extract(csv, { account: ACCOUNT }, {
			isinToSymbol: { IE00BZ163M45: 'VUCP.AS' }
		});
		expect(dividend.payee).toBe('VUCP.AS distribution');
	});

	it('matches one-to-one', () => {
		const results = findDuplicates(
			[xact('2026-09-08', -7.15), xact('2026-09-08', -7.15)],
			[xact('2026-09-08', -7.15)],
			ACCOUNT
		);
		expect(results.map((r) => !!r.duplicateOf)).toEqual([true, false]);
	});
});
