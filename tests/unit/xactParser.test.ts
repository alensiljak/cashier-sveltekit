/*
    Tests for transaction parser.
    directiveToXact maps a raw WASM directive object to an Xact view model.
*/
import { expect, test } from 'vitest';
import { directiveToXact } from '$lib/utils/transactionParser';

function makeDirective(overrides: any = {}) {
	return {
		type: 'transaction',
		date: '2024-12-01',
		payee: 'Supermarket',
		narration: 'some food',
		flag: '*',
		postings: [],
		...overrides
	};
}

test('maps basic transaction fields', () => {
	const result = directiveToXact(makeDirective());

	expect(result.date).toBe('2024-12-01');
	expect(result.payee).toBe('Supermarket');
	expect(result.note).toBe('some food');
	expect(result.flag).toBe('*');
});

test('maps posting with account and units', () => {
	const directive = makeDirective({
		postings: [
			{ account: 'Expenses:Food', units: { number: '13', currency: 'EUR' } },
			{ account: 'Assets:Cash' }
		]
	});

	const result = directiveToXact(directive);

	expect(result.postings[0].account).toBe('Expenses:Food');
	expect(result.postings[0].amount).toBe(13);
	expect(result.postings[0].currency).toBe('EUR');
	expect(result.postings[1].account).toBe('Assets:Cash');
	expect(result.postings[1].amount).toBeUndefined();
});

test('maps @@ total price annotation', () => {
	const directive = makeDirective({
		postings: [
			{
				account: 'Expenses:Health:Diagnostics',
				units: { number: '35', currency: 'BAM' },
				price: { number: '17.9', currency: 'EUR', total: true }
			}
		]
	});

	const result = directiveToXact(directive);
	const p = result.postings[0];

	expect(p.currency).toBe('BAM');
	expect(p.priceAmount).toBe(17.9);
	expect(p.priceCurrency).toBe('EUR');
	expect(p.totalPrice).toBe(true);
});

test('maps @ unit price annotation', () => {
	const directive = makeDirective({
		postings: [
			{
				account: 'Assets:Portfolio',
				units: { number: '10', currency: 'AAPL' },
				price: { number: '150', currency: 'USD', total: false }
			}
		]
	});

	const result = directiveToXact(directive);
	const p = result.postings[0];

	expect(p.currency).toBe('AAPL');
	expect(p.priceAmount).toBe(150);
	expect(p.priceCurrency).toBe('USD');
	expect(p.totalPrice).toBe(false);
});

test('detects @@ totalPrice from rawSource when WASM omits price.total', () => {
	const directive = makeDirective({
		postings: [
			{
				account: 'Expenses:Health:Diagnostics',
				units: { number: '35', currency: 'BAM' },
				price: { number: '17.9', currency: 'EUR' }
			}
		]
	});
	const rawSource = `2024-12-01 * "Clinic"
  Expenses:Health:Diagnostics  35 BAM @@ 17.9 EUR
  Assets:Cash`;

	const result = directiveToXact(directive, rawSource);
	const p = result.postings[0];

	expect(p.priceAmount).toBe(17.9);
	expect(p.priceCurrency).toBe('EUR');
	expect(p.totalPrice).toBe(true);
});

test('does not set totalPrice for @ when rawSource has no @@', () => {
	const directive = makeDirective({
		postings: [
			{
				account: 'Assets:Portfolio',
				units: { number: '10', currency: 'AAPL' },
				price: { number: '150', currency: 'USD' }
			}
		]
	});
	const rawSource = `2024-12-01 * "Buy"
  Assets:Portfolio  10 AAPL @ 150 USD
  Assets:Cash`;

	const result = directiveToXact(directive, rawSource);
	expect(result.postings[0].totalPrice).toBe(false);
});

test('maps cost annotation (per_unit CostNumberJson from WASM)', () => {
	const directive = makeDirective({
		postings: [
			{
				account: 'Assets:Portfolio',
				units: { number: '10', currency: 'AAPL' },
				cost: { number: { kind: 'per_unit', value: '140' }, currency: 'USD', date: '2024-01-01' }
			}
		]
	});

	const result = directiveToXact(directive);
	const p = result.postings[0];

	expect(p.costAmount).toBe(140);
	expect(p.costCurrency).toBe('USD');
	expect(p.costDate).toBe('2024-01-01');
});

test('maps cost annotation (plain string number, backwards compat)', () => {
	const directive = makeDirective({
		postings: [
			{
				account: 'Assets:Portfolio',
				units: { number: '10', currency: 'AAPL' },
				cost: { number: '140', currency: 'USD' }
			}
		]
	});

	const result = directiveToXact(directive);
	expect(result.postings[0].costAmount).toBe(140);
});

test('recovers the original @@ total from rawSource when the directive price has been booked to a per-unit number', () => {
	// A booked ParsedLedger (getDirectives() after interpolation) rewrites `@@ total`
	// into an equivalent `@ per-unit` price and never sets price.total — so without
	// rawSource fallback the UI would show e.g. "@@ 1.3636363636363636363636363636 USD"
	// instead of the user's original "@@ 15 USD".
	const directive = makeDirective({
		postings: [
			{
				account: 'Assets:Accounts-Receivable:Sandi:EUR',
				units: { number: '11', currency: 'EUR' },
				price: { number: '1.3636363636363636363636363636', currency: 'USD' }
			},
			{ account: 'Expenses:Uncategorized', units: { number: '-15', currency: 'USD' } }
		]
	});
	const rawSource = `2026-09-05 * "Sandi"
  Assets:Accounts-Receivable:Sandi:EUR  11 EUR @@ 15 USD
  Expenses:Uncategorized`;

	const result = directiveToXact(directive, rawSource);
	const p = result.postings[0];

	expect(p.priceAmount).toBe(15);
	expect(p.priceCurrency).toBe('USD');
	expect(p.totalPrice).toBe(true);
});

test('recovers the original @ per-unit price from rawSource even when the directive omits price.total', () => {
	const directive = makeDirective({
		postings: [
			{
				account: 'Assets:Bank-Accounts:N26',
				units: { number: '25', currency: 'EUR' },
				price: { number: '1.25', currency: 'USD' }
			}
		]
	});
	const rawSource = `2026-09-05 * "FX"
  Assets:Bank-Accounts:N26  25 EUR @ 1.25 USD
  Assets:Cash`;

	const result = directiveToXact(directive, rawSource);
	const p = result.postings[0];

	expect(p.priceAmount).toBe(1.25);
	expect(p.priceCurrency).toBe('USD');
	expect(p.totalPrice).toBe(false);
});
