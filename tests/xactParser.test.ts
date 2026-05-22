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

test('maps cost annotation', () => {
	const directive = makeDirective({
		postings: [
			{
				account: 'Assets:Portfolio',
				units: { number: '10', currency: 'AAPL' },
				cost: { number: '140', currency: 'USD', date: '2024-01-01' }
			}
		]
	});

	const result = directiveToXact(directive);
	const p = result.postings[0];

	expect(p.costAmount).toBe(140);
	expect(p.costCurrency).toBe('USD');
	expect(p.costDate).toBe('2024-01-01');
});
