/*
    Tests for the posting cost/price display helpers used by the journal rows.
*/
import { expect, test } from 'vitest';
import { Posting } from '$lib/data/model';
import { formatPostingCost, formatPostingPrice } from '$lib/utils/formatter';

function makePosting(overrides: Partial<Posting> = {}): Posting {
	const p = new Posting();
	p.account = 'Assets:Portfolio';
	p.amount = 1;
	p.currency = 'VWCE';
	Object.assign(p, overrides);
	return p;
}

test('formats cost annotation with braces', () => {
	const p = makePosting({ costAmount: 13.2, costCurrency: 'EUR' });

	expect(formatPostingCost(p)).toBe('{13.2 EUR}');
});

test('returns empty cost when posting has no cost annotation', () => {
	expect(formatPostingCost(makePosting())).toBe('');
});

test('returns empty cost when cost currency is missing', () => {
	const p = makePosting({ costAmount: 13.2 });

	expect(formatPostingCost(p)).toBe('');
});

test('formats unit price with @', () => {
	const p = makePosting({ priceAmount: 1.95, priceCurrency: 'EUR', totalPrice: false });

	expect(formatPostingPrice(p)).toBe('@ 1.95 EUR');
});

test('formats unit price with @ when totalPrice is undefined', () => {
	const p = makePosting({ priceAmount: 1.95, priceCurrency: 'EUR' });

	expect(formatPostingPrice(p)).toBe('@ 1.95 EUR');
});

test('formats total price with @@', () => {
	const p = makePosting({
		amount: 35,
		currency: 'BAM',
		priceAmount: 17.9,
		priceCurrency: 'EUR',
		totalPrice: true
	});

	expect(formatPostingPrice(p)).toBe('@@ 17.9 EUR');
});

test('returns empty price when posting has no price annotation', () => {
	expect(formatPostingPrice(makePosting())).toBe('');
});

test('formats a zero price amount (not treated as missing)', () => {
	const p = makePosting({ priceAmount: 0, priceCurrency: 'EUR' });

	expect(formatPostingPrice(p)).toBe('@ 0 EUR');
});
