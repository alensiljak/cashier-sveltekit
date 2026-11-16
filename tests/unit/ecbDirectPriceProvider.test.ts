/*
    Tests for the direct ECB XML provider: feed parsing and validation.
*/
import { describe, expect, it } from 'vitest';
import { parseEcbXml } from '../../src/lib/services/prices/ecbDirectPriceProvider';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
	<gesmes:subject>Reference rates</gesmes:subject>
	<Cube>
		<Cube time='2026-11-13'>
			<Cube currency='USD' rate='1.0812'/>
			<Cube currency='CHF' rate='0.9266'/>
			<Cube currency='JPY' rate='163.5'/>
		</Cube>
	</Cube>
</gesmes:Envelope>`;

describe('parseEcbXml', () => {
	it('extracts the fixing date and requested rates', () => {
		const result = parseEcbXml(FEED, ['USD', 'CHF']);
		expect(result.asOf).toBe('2026-11-13');
		expect(result.quotes).toEqual([
			{ base: 'EUR', rate: 1.0812, quote: 'USD' },
			{ base: 'EUR', rate: 0.9266, quote: 'CHF' }
		]);
		expect(result.missing).toEqual([]);
	});

	it('reports requested symbols absent from the feed', () => {
		const result = parseEcbXml(FEED, ['USD', 'AUD']);
		expect(result.quotes.map((q) => q.quote)).toEqual(['USD']);
		expect(result.missing).toEqual(['AUD']);
	});

	it('rejects a feed without a valid date', () => {
		expect(() => parseEcbXml("<Cube><Cube currency='USD' rate='1.1'/></Cube>", ['USD'])).toThrow(
			/date/
		);
	});

	it('rejects invalid rates and empty feeds', () => {
		expect(() =>
			parseEcbXml("<Cube time='2026-11-13'><Cube currency='USD' rate='abc'/></Cube>", ['USD'])
		).toThrow(/invalid rate/);
		expect(() => parseEcbXml("<Cube time='2026-11-13'></Cube>", ['USD'])).toThrow(/no rates/);
	});
});
