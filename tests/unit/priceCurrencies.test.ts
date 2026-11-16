/*
    Tests for the book-relevant symbol derivation of the Price Download
    feature. Only the pure planner is under test here — the import of
    ledgerWorkerClient is side-effect-safe (tests/setup.ts stubs Worker),
    and no query is ever sent.
*/
import { describe, expect, it } from 'vitest';
import { derivePriceSymbols } from '#lib/services/prices/priceCurrencies';

const covers = (symbol: string) => ['USD', 'CHF', 'AUD', 'GBP'].includes(symbol);

function plan(input: Partial<Parameters<typeof derivePriceSymbols>[0]> = {}) {
	return derivePriceSymbols({
		base: 'EUR',
		defaultCurrency: 'EUR',
		operatingCurrencies: ['EUR'],
		pairCurrencies: [],
		accountCurrencies: [],
		ownedPairs: [],
		declaredSecurities: [],
		covers,
		...input
	});
}

describe('derivePriceSymbols', () => {
	it('collects default, operating, pair and account currencies, deduplicated', () => {
		expect(
			plan({
				defaultCurrency: 'USD',
				operatingCurrencies: ['EUR', 'USD'],
				pairCurrencies: ['CHF', 'USD', 'EUR'],
				accountCurrencies: ['GBP', 'CHF']
			})
		).toEqual({
			symbols: ['USD', 'CHF', 'GBP'],
			invertedSymbols: [],
			skippedUnsupported: [],
			securities: []
		});
	});

	it('excludes the provider base and empty candidates', () => {
		const result = plan({ pairCurrencies: ['EUR', '', 'USD'] });
		expect(result.symbols).toEqual(['USD']);
	});

	it('splits out currency candidates the provider cannot serve', () => {
		const result = plan({ pairCurrencies: ['USD', 'HRK'], accountCurrencies: ['ROL'] });
		expect(result.symbols).toEqual(['USD']);
		expect(result.skippedUnsupported).toEqual(['HRK', 'ROL']);
	});

	it('lists declared securities separately instead of as skips', () => {
		const result = plan({
			pairCurrencies: ['VTI', 'USD'],
			accountCurrencies: ['UBUD.DE'],
			declaredSecurities: ['VTI', 'UBUD.DE']
		});
		expect(result.symbols).toEqual(['USD']);
		expect(result.securities).toEqual(['VTI', 'UBUD.DE']);
		expect(result.skippedUnsupported).toEqual([]);
	});

	it('writes maintained reverse-direction series in the book own direction', () => {
		// The book keeps `price USD 0.9 EUR` history: the engine coalesces both
		// directions of a pair (denser series wins), so a fresh EUR→USD series
		// would be ignored. The rates are fetched but written inverted,
		// extending the user's USD → EUR series.
		const result = plan({
			defaultCurrency: 'CHF',
			pairCurrencies: ['USD', 'EUR'],
			ownedPairs: [{ base: 'USD', quote: 'EUR' }]
		});
		expect(result).toEqual({
			symbols: ['CHF'],
			invertedSymbols: ['USD'],
			skippedUnsupported: [],
			securities: []
		});
	});

	it('fetches normally when the book maintains the native direction', () => {
		// The book keeps EUR→CHF prices itself: same direction as ours, which
		// just extends the series.
		const result = plan({
			defaultCurrency: 'CHF',
			ownedPairs: [{ base: 'EUR', quote: 'CHF' }]
		});
		expect(result.symbols).toEqual(['CHF']);
		expect(result.invertedSymbols).toEqual([]);
	});

	it('prefers the book series direction over pairs the app downloaded earlier', () => {
		// ownedPairs is priority-ordered: user-maintained pairs first, then the
		// destination file's own (previously downloaded) pairs.
		const result = plan({
			pairCurrencies: ['USD', 'EUR'],
			ownedPairs: [
				{ base: 'USD', quote: 'EUR' }, // user's series: USD → EUR
				{ base: 'EUR', quote: 'USD' } //  app's earlier native download
			]
		});
		expect(result.invertedSymbols).toEqual(['USD']);
	});

	it('returns empty sets when the book is EUR-only', () => {
		const result = plan();
		expect(result.symbols).toEqual([]);
		expect(result.invertedSymbols).toEqual([]);
		expect(result.skippedUnsupported).toEqual([]);
		expect(result.securities).toEqual([]);
	});
});
