import { describe, expect, it } from 'vitest';
import { buildBookPricePlan, parsePriceMeta } from '#lib/services/prices/bookPricePlan';
import { ecbPriceProvider } from '#lib/services/prices/ecbPriceProvider';
import { vanguardAuPriceProvider } from '#lib/services/prices/vanguardAuPriceProvider';

describe('parsePriceMeta', () => {
	it('parses QUOTE:source/SYMBOL', () => {
		expect(parsePriceMeta('EUR:ecbrates/AUD-EUR')).toEqual({
			specs: [{ quote: 'EUR', source: 'ecbrates', symbol: 'AUD-EUR', inverted: false }],
			malformed: []
		});
	});

	it('parses dotted module paths, inversion and fallbacks', () => {
		const r = parsePriceMeta(
			'AUD:alens.pricedl.beanprice.vanguard_au_detail/PROP, USD:yahoo/^AUDUSD=X'
		);
		expect(r.specs).toEqual([
			{ quote: 'AUD', source: 'alens.pricedl.beanprice.vanguard_au_detail', symbol: 'PROP', inverted: false },
			{ quote: 'USD', source: 'yahoo', symbol: 'AUDUSD=X', inverted: true }
		]);
	});

	it('flags malformed entries and non-strings', () => {
		expect(parsePriceMeta('nonsense').malformed).toEqual(['nonsense']);
		expect(parsePriceMeta(42).malformed).toEqual(['42']);
		expect(parsePriceMeta(undefined)).toEqual({ specs: [], malformed: [] });
	});
});

describe('buildBookPricePlan', () => {
	const providers = [ecbPriceProvider, vanguardAuPriceProvider];
	const state = (plan: ReturnType<typeof buildBookPricePlan>, c: string) =>
		plan.entries.find((e) => e.commodity === c)?.state;

	it('classifies every commodity', () => {
		const plan = buildBookPricePlan({
			commodities: [
				{ currency: 'AUD', meta: { price: 'EUR:ecbrates/AUD-EUR' } },
				{ currency: 'USD', meta: { price: 'EUR:ecbrates/AUD-EUR' } }, // symbol mismatch
				{ currency: 'XYZ', meta: { price: 'EUR:mystery/XYZ-EUR' } },
				{ currency: 'GBP', meta: { price: 'bad' } },
				{ currency: 'BTC' },
				{ currency: 'HOUSE' }
			],
			nicknames: { ecbrates: 'ecb-frankfurter' },
			ignored: ['HOUSE'],
			providers
		});
		expect(state(plan, 'AUD')).toBe('mapped');
		expect(state(plan, 'USD')).toBe('invalid');
		expect(state(plan, 'XYZ')).toBe('unmapped-source');
		expect(state(plan, 'GBP')).toBe('invalid');
		expect(state(plan, 'BTC')).toBe('untagged');
		expect(state(plan, 'HOUSE')).toBe('ignored');
		expect(plan.entries.find((e) => e.commodity === 'XYZ')?.source).toBe('mystery');
	});

	it('reports which providers take part in the full download', () => {
		const plan = buildBookPricePlan({
			commodities: [{ currency: 'AUD', meta: { price: 'EUR:ecbrates/AUD-EUR' } }],
			nicknames: { ecbrates: 'ecb-frankfurter' },
			ignored: [],
			providers
		});
		const ecb = plan.providers.find((p) => p.providerId === 'ecb-frankfurter');
		const vg = plan.providers.find((p) => p.providerId === 'vanguard-au');
		expect(ecb).toMatchObject({ included: true, nicknames: ['ecbrates'], commodities: ['AUD'] });
		expect(vg?.included).toBe(false);
		expect(plan.sources).toEqual([{ source: 'ecbrates', count: 1, providerId: 'ecb-frankfurter' }]);
	});
});
