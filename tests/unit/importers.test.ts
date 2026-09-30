import { describe, expect, it } from 'vitest';
import { findDuplicates } from '../../src/lib/importers/dedup';
import { identifyImporter } from '../../src/lib/importers';
import { n26Importer } from '../../src/lib/importers/n26';
import { allRules, replaceRule, withRules, type RuleConfig } from '../../src/lib/importers/rules';
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

	it('extracts plain transactions and keeps the extra facts in details only', () => {
		const [purchase, dividend] = n26Importer.extract(csv, {
			account: ACCOUNT,
			isinToSymbol: { IE00BZ163M45: 'VWRL' },
			rules: [{ match: '^lidl', payee: 'Lidl', account: 'Expenses:Groceries' }]
		});
		expect(purchase.xact.payee).toBe('Lidl');
		expect(purchase.xact.meta).toEqual({});
		// The receiving (positive) posting comes first.
		expect(purchase.xact.postings.map((p) => [p.account, p.amount])).toEqual([
			['Expenses:Groceries', 13.58],
			[ACCOUNT, -13.58]
		]);
		expect(Object.fromEntries(purchase.details)).toMatchObject({
			'Original payee': 'Lidl Oesterreich GmbH',
			'Value date': '2026-09-02'
		});
		expect(dividend.xact.payee).toBe('VWRL distribution');
		// Distributions are the exception: reports link them to a security by ISIN.
		expect(dividend.xact.meta).toEqual({ isin: 'IE00BZ163M45' });
		expect(dividend.xact.postings.map((p) => p.account)).toEqual([
			ACCOUNT,
			'Income:Dividends:VWRL'
		]);
	});

	it('reads the older payeeRenames / categories lists as rules', () => {
		const [purchase] = n26Importer.extract(csv, {
			account: ACCOUNT,
			payeeRenames: [['^lidl', 'Lidl']],
			categories: [['^lidl', 'Expenses:Groceries']]
		});
		expect(purchase.xact.payee).toBe('Lidl');
		expect(purchase.xact.postings[0].account).toBe('Expenses:Groceries');
	});

	it('takes each field from the first enabled matching rule that sets it', () => {
		const [purchase] = n26Importer.extract(csv, {
			account: ACCOUNT,
			rules: [
				{ match: 'oesterreich', payee: 'Skipped', disabled: true },
				{ match: 'oesterreich', account: 'Expenses:Electricity' },
				{ match: '^lidl', payee: 'Lidl', account: 'Expenses:Groceries' }
			]
		});
		expect(purchase.xact.payee).toBe('Lidl');
		expect(purchase.xact.postings[0].account).toBe('Expenses:Electricity');
	});

	it('flags transactions still on the placeholder account with !', () => {
		const plain = n26Importer.extract(csv, { account: ACCOUNT })[0];
		expect(plain.xact.flag).toBe('!');
		const categorised = n26Importer.extract(csv, {
			account: ACCOUNT,
			rules: [{ match: '^lidl', account: 'Expenses:Groceries' }]
		})[0];
		expect(categorised.xact.flag).toBe('*');
	});

	it('applies rules to distributions too, e.g. a bond fund to an interest account', () => {
		const [, dividend] = n26Importer.extract(csv, {
			account: ACCOUNT,
			isinToSymbol: { IE00BZ163M45: 'VUCP.AS' },
			rules: [{ match: 'VUCP\\.AS', account: 'Income:Interest:N26' }]
		});
		expect(dividend.xact.postings.map((p) => p.account)).toEqual([ACCOUNT, 'Income:Interest:N26']);
		expect(dividend.xact.flag).toBe('*');
		// The symbol is the first thing a new rule is prefilled with.
		expect(dividend.matchText[0]).toBe('VUCP.AS');
	});

	it('reports which rules changed a row, and edits or deletes them by position', () => {
		const config = {
			account: ACCOUNT,
			rules: [
				{ match: 'nomatch', payee: 'X' },
				{ match: '^lidl', payee: 'Lidl' },
				{ match: 'oesterreich', account: 'Expenses:Groceries' }
			]
		};
		const [purchase] = n26Importer.extract(csv, config);
		expect(purchase.appliedRules).toEqual([1, 2]);

		const edited = replaceRule(config, 1, { match: '^lidl', payee: 'Lidl AT' });
		expect(edited.rules[1].payee).toBe('Lidl AT');
		expect(replaceRule(config, 0, null).rules.map((r) => r.match)).toEqual([
			'^lidl',
			'oesterreich'
		]);
		// Older-format lists are folded in, with the same positions.
		const older: RuleConfig = {
			payeeRenames: [
				['a', 'A'],
				['b', 'B']
			]
		};
		const legacy = replaceRule(older, 1, null);
		expect(legacy.rules?.map((r) => r.match)).toEqual(['a']);
		expect(legacy.payeeRenames).toBeUndefined();
	});

	it('saves a reordered list, dropping the older-format lists', () => {
		const older: RuleConfig = { payeeRenames: [['a', 'A']], categories: [['b', 'Expenses:B']] };
		const reordered = allRules(older).reverse();
		const next = withRules(older, reordered);
		expect(next.rules?.map((r) => r.match)).toEqual(['b', 'a']);
		expect(next.payeeRenames).toBeUndefined();
		expect(next.categories).toBeUndefined();
	});

	it('shows the raw records when rules are muted', () => {
		const [purchase] = n26Importer.extract(
			csv,
			{ account: ACCOUNT, rules: [{ match: '^lidl', payee: 'Lidl' }] },
			{ applyRules: false }
		);
		expect(purchase.xact.payee).toBe('Lidl Oesterreich GmbH');
	});
});

describe('findDuplicates', () => {
	it('matches within the date window regardless of the counter-account', () => {
		const [r] = findDuplicates(
			[xact('2026-09-03', -13.58, 'Expenses:Uncategorized')],
			[xact('2026-09-01', -13.58)],
			ACCOUNT
		);
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
		const [, dividend] = n26Importer.extract(
			csv,
			{ account: ACCOUNT },
			{ isinToSymbol: { IE00BZ163M45: 'VUCP.AS' } }
		);
		expect(dividend.xact.payee).toBe('VUCP.AS distribution');
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
