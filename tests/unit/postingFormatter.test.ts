/*
    Tests for the posting cost/price display helpers used by the journal rows.
*/
import { expect, test } from 'vitest';
import type { Posting } from '$lib/data/model';
import { makePosting } from '../helpers/factories';
import { formatPostingCost, formatPostingPrice } from '$lib/utils/formatter';

function makePostingDefaults(overrides: Partial<Posting> = {}): Posting {
	return makePosting({ account: 'Assets:Portfolio', amount: 1, currency: 'VWCE', ...overrides });
}

test('formats cost annotation with braces', () => {
	const p = makePostingDefaults({ costAmount: 13.2, costCurrency: 'EUR' });

	expect(formatPostingCost(p)).toBe('{13.2 EUR}');
});

test('returns empty cost when posting has no cost annotation', () => {
	expect(formatPostingCost(makePostingDefaults())).toBe('');
});

test('returns empty cost when cost currency is missing', () => {
	const p = makePostingDefaults({ costAmount: 13.2 });

	expect(formatPostingCost(p)).toBe('');
});

test('formats unit price with @', () => {
	const p = makePostingDefaults({ priceAmount: 1.95, priceCurrency: 'EUR', totalPrice: false });

	expect(formatPostingPrice(p)).toBe('@ 1.95 EUR');
});

test('formats unit price with @ when totalPrice is undefined', () => {
	const p = makePostingDefaults({ priceAmount: 1.95, priceCurrency: 'EUR' });

	expect(formatPostingPrice(p)).toBe('@ 1.95 EUR');
});

test('formats total price with @@', () => {
	const p = makePostingDefaults({
		amount: 35,
		currency: 'BAM',
		priceAmount: 17.9,
		priceCurrency: 'EUR',
		totalPrice: true
	});

	expect(formatPostingPrice(p)).toBe('@@ 17.9 EUR');
});

test('returns empty price when posting has no price annotation', () => {
	expect(formatPostingPrice(makePostingDefaults())).toBe('');
});

test('formats a zero price amount (not treated as missing)', () => {
	const p = makePostingDefaults({ priceAmount: 0, priceCurrency: 'EUR' });

	expect(formatPostingPrice(p)).toBe('@ 0 EUR');
});
