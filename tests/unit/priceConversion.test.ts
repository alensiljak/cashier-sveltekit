/*
    Price conversion direction contract of the rustledger engine.

    Pins the assumption the Price Download design relies on
    (doc/projects/2026-11-15_price-download.md): downloaded prices are stored
    in the provider's published direction (ECB is EUR-base, e.g.
    `price EUR 1.1052 USD`), and the engine is trusted to invert and chain
    them on lookup. If a future engine version stops doing that, these tests
    fail before anything in the price-download feature silently breaks.

    Also covers the nested destination path the feature writes to
    (prices/prices.current.bean, folded in via an `include` from the root
    book) so the multi-file file-map resolution is exercised too.
*/
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureInitialized, queryMultiFile } from '#lib/services/rustledger';

// Small throwaway book. Price dates are far enough in the past that
// latest-price lookups never depend on the wall clock.
const BOOK = `
option "operating_currency" "EUR"

2020-01-01 open Assets:Cash USD
2020-01-01 open Equity:Opening

2020-01-02 * "opening"
  Assets:Cash  1000 USD
  Equity:Opening

include "prices/prices.current.bean"
`;

// Exactly what the price download would write: the provider's native pairs,
// verbatim — EUR base from the ECB, no inversions, no cross rates.
const PRICES = `; ECB reference rates (via frankfurter.dev, provider ecb)
2020-01-01 price EUR 1.1052 USD
2020-01-01 price AAPL 150.00 USD
`;

const files: Record<string, string> = {
	'book.bean': BOOK,
	'prices/prices.current.bean': PRICES
};

/** Convert an amount literal through the engine; null when no price path. */
function convert(amount: string, currency: string): { number: number; currency: string } | null {
	const result = queryMultiFile(files, 'book.bean', `SELECT CONVERT('${amount}', '${currency}')`);
	expect(result.errors, 'query errors').toEqual([]);

	const row = (result.rows ?? [])[0] ?? [];
	const val = row[0] as { number: string; currency: string } | null;
	if (!val?.number) return null;
	return { number: parseFloat(val.number), currency: val.currency };
}

beforeAll(async () => {
	await ensureInitialized();
});

describe('CONVERT resolves prices in both directions', () => {
	it('inverts a native-direction pair (USD -> EUR from `price EUR 1.1052 USD`)', () => {
		const val = convert('100 USD', 'EUR');
		expect(val?.currency).toBe('EUR');
		expect(val?.number).toBeCloseTo(100 / 1.1052, 3);
	});

	it('uses a native-direction pair as published (EUR -> USD)', () => {
		const val = convert('100 EUR', 'USD');
		expect(val?.currency).toBe('USD');
		expect(val?.number).toBeCloseTo(100 * 1.1052, 3);
	});

	it('chains a commodity leg through an inverted FX leg (AAPL -> USD -> EUR)', () => {
		const val = convert('2 AAPL', 'EUR');
		expect(val?.currency).toBe('EUR');
		// 2 AAPL = 300 USD via the AAPL price, then inverted EUR/USD FX leg.
		expect(val?.number).toBeCloseTo((2 * 150) / 1.1052, 3);
	});

	it('returns the amount unchanged when no price path exists (BQL identity fallback)', () => {
		// CONVERT does not signal a missing path with null — it returns the
		// original amount in its own currency. Callers that need to know
		// whether a real conversion happened must compare the returned
		// currency, not check for null.
		expect(convert('100 CHF', 'EUR')).toEqual({ number: 100, currency: 'CHF' });
	});
});
