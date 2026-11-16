/*
    Tests for the price file service: fixed formatting, parsing, overwrite
    output, and the append merge (key collisions, foreign lines,
    determinism). The output must converge to identical bytes for identical
    input so the S3/WebDAV file sync sees "equivalent" content.
*/
import { describe, expect, it } from 'vitest';
import {
	buildPriceFile,
	formatRate,
	mergePriceFile,
	parsePriceFile,
	parsePriceLine,
	priceKey,
	renderDirectives,
	toDirectives,
	type PriceDirective
} from '#lib/services/prices/priceFileService';

const d = (date: string, base: string, rate: number, quote: string): PriceDirective => ({
	date,
	base,
	rate,
	quote
});

describe('formatRate', () => {
	it('keeps the served precision and trims trailing zeros', () => {
		expect(formatRate(1.1052)).toBe('1.1052');
		expect(formatRate(0.9266)).toBe('0.9266');
		expect(formatRate(1.1)).toBe('1.1');
		expect(formatRate(17049)).toBe('17049');
		expect(formatRate(1.1052)).toBe('1.1052');
	});

	it('caps at 6 decimals', () => {
		expect(formatRate(1 / 3)).toBe('0.333333');
	});

	it('rejects non-positive or non-finite rates', () => {
		expect(() => formatRate(0)).toThrow();
		expect(() => formatRate(-1)).toThrow();
		expect(() => formatRate(Number.NaN)).toThrow();
		expect(() => formatRate(1e-9)).toThrow();
	});
});

describe('parsePriceLine', () => {
	it('parses a plain directive', () => {
		expect(parsePriceLine('2026-11-13 price EUR 1.1052 USD')).toEqual({
			date: '2026-11-13',
			base: 'EUR',
			rate: 1.1052,
			quote: 'USD'
		});
	});

	it('tolerates a trailing comment and quoted symbols', () => {
		expect(parsePriceLine('2026-01-01 price "VTI " 202.50 EUR ; manual')).toEqual({
			date: '2026-01-01',
			base: 'VTI ',
			rate: 202.5,
			quote: 'EUR'
		});
	});

	it('returns null for non-price lines', () => {
		expect(parsePriceLine('; a comment')).toBeNull();
		expect(parsePriceLine('2026-01-01 open Assets:Cash EUR')).toBeNull();
		expect(parsePriceLine('2026-13-45 price EUR 1 USD')).toBeNull();
		expect(parsePriceLine('')).toBeNull();
		expect(parsePriceLine('2026-01-01 price XYZ 0 EUR')).toBeNull();
	});
});

describe('renderDirectives', () => {
	it('sorts by (date, base, quote) and uses the fixed format', () => {
		const out = renderDirectives([
			d('2026-11-13', 'EUR', 1.1052, 'USD'),
			d('2026-11-12', 'EUR', 0.9266, 'CHF'),
			d('2026-11-13', 'EUR', 0.9266, 'CHF')
		]);
		expect(out).toEqual([
			'2026-11-12 price EUR 0.9266 CHF',
			'2026-11-13 price EUR 0.9266 CHF',
			'2026-11-13 price EUR 1.1052 USD'
		]);
	});
});

describe('buildPriceFile (overwrite mode)', () => {
	it('writes the header, latest directives only, deterministically', () => {
		const directives = [
			d('2026-11-13', 'EUR', 1.1052, 'USD'),
			d('2026-11-13', 'EUR', 0.9266, 'CHF')
		];
		const text = buildPriceFile(directives, 'ECB reference rates (via Frankfurter)', '2026-11-13');
		expect(text).toBe(
			[
				'; ECB reference rates (via Frankfurter) — latest fixing: 2026-11-13',
				'2026-11-13 price EUR 0.9266 CHF',
				'2026-11-13 price EUR 1.1052 USD',
				''
			].join('\n')
		);
		expect(buildPriceFile(directives, 'ECB reference rates (via Frankfurter)', '2026-11-13')).toBe(
			text
		);
	});
});

describe('mergePriceFile (append mode)', () => {
	it('adds new dates and preserves non-price lines verbatim', () => {
		const existing = '; header comment\n\n2026-11-10 price EUR 1.1 USD\n';
		const merged = mergePriceFile(existing, [d('2026-11-13', 'EUR', 1.1052, 'USD')]);
		expect(merged.added).toBe(1);
		expect(merged.updated).toBe(0);
		expect(merged.text).toBe(
			[
				'; header comment',
				'',
				'2026-11-10 price EUR 1.1 USD',
				'2026-11-13 price EUR 1.1052 USD',
				''
			].join('\n')
		);
	});

	it('is idempotent for identical rates', () => {
		const existing = mergePriceFile('', [d('2026-11-13', 'EUR', 1.1052, 'USD')]).text;
		const again = mergePriceFile(existing, [d('2026-11-13', 'EUR', 1.1052, 'USD')]);
		expect(again.added).toBe(0);
		expect(again.updated).toBe(0);
		expect(again.text).toBe(existing);
	});

	it('lets the incoming value win on a same-key collision', () => {
		const existing = '2026-11-13 price EUR 1.1051 USD\n';
		const merged = mergePriceFile(existing, [d('2026-11-13', 'EUR', 1.1052, 'USD')]);
		expect(merged.added).toBe(0);
		expect(merged.updated).toBe(1);
		expect(merged.text).toContain('2026-11-13 price EUR 1.1052 USD');
		expect(merged.text).not.toContain('1.1051');
	});

	it('leaves the user’s own price lines byte for byte untouched', () => {
		const existing =
			'2026-01-01 price "VTI " 202.50 EUR ; manual\n2026-01-02 price ABC 202.123456789 EUR\n';
		const merged = mergePriceFile(existing, [d('2026-11-13', 'EUR', 1.1052, 'USD')]);
		expect(merged.text).toBe(existing + '2026-11-13 price EUR 1.1052 USD\n');
	});

	it('does not crash on a zero-rate line and keeps it verbatim', () => {
		const existing = '2026-01-01 price XYZ 0 EUR\n';
		const merged = mergePriceFile(existing, [d('2026-11-13', 'EUR', 1.1052, 'USD')]);
		expect(merged.text).toBe(existing + '2026-11-13 price EUR 1.1052 USD\n');
	});

	it('replaces only the changed line, keeping everything else in place', () => {
		const existing = '2026-11-13 price EUR 1.1051 USD ; old\n; tail\n';
		const merged = mergePriceFile(existing, [d('2026-11-13', 'EUR', 1.1052, 'USD')]);
		expect(merged.text).toBe('2026-11-13 price EUR 1.1052 USD\n; tail\n');
	});

	it('preserves CRLF line endings', () => {
		const merged = mergePriceFile('; c\r\n', [d('2026-11-13', 'EUR', 1.1052, 'USD')]);
		expect(merged.text).toBe('; c\r\n2026-11-13 price EUR 1.1052 USD\r\n');
	});

	it('is deterministic regardless of input order', () => {
		const a = [d('2026-11-13', 'EUR', 1.1052, 'USD'), d('2026-11-13', 'EUR', 0.9266, 'CHF')];
		const b = [...a].reverse();
		expect(mergePriceFile('', b).text).toBe(mergePriceFile('', a).text);
	});

	it('handles an empty existing file', () => {
		const merged = mergePriceFile('', [d('2026-11-13', 'EUR', 1.1052, 'USD')]);
		expect(merged.text).toBe('2026-11-13 price EUR 1.1052 USD\n');
	});
});

describe('toDirectives', () => {
	const fetched = {
		asOf: '2026-11-13',
		quotes: [
			{ base: 'EUR', rate: 1.1052, quote: 'USD' },
			{ base: 'EUR', rate: 0.9266, quote: 'CHF' }
		]
	};

	it('keeps native pairs verbatim', () => {
		expect(toDirectives(fetched, [], 'EUR')).toEqual([
			d('2026-11-13', 'EUR', 1.1052, 'USD'),
			d('2026-11-13', 'EUR', 0.9266, 'CHF')
		]);
	});

	it('inverts the symbols the book maintains in the opposite direction', () => {
		const directives = toDirectives(fetched, ['USD'], 'EUR');
		// USD → EUR series: 1 / 1.1052, deterministically formatted later.
		expect(directives[0]).toEqual({
			date: '2026-11-13',
			base: 'USD',
			rate: 1 / 1.1052,
			quote: 'EUR'
		});
		expect(directives[1]).toEqual(d('2026-11-13', 'EUR', 0.9266, 'CHF'));
		// The inverted value renders byte-identically on every device.
		expect(formatRate(directives[0].rate)).toBe('0.904814');
	});

	it('produces mergeable keys: inverted and native directives do not collide', () => {
		const directives = toDirectives(fetched, ['USD'], 'EUR');
		const keys = directives.map(priceKey);
		expect(new Set(keys).size).toBe(2);
	});
});

describe('parsePriceFile round-trip', () => {
	it('re-parses merged output to the same directives', () => {
		const incoming = [d('2026-11-13', 'EUR', 1.1052, 'USD'), d('2026-11-13', 'EUR', 0.9266, 'CHF')];
		const merged = mergePriceFile('; note\n', incoming);
		const parsed = parsePriceFile(merged.text);
		expect(parsed.directives.size).toBe(2);
		// The trailing split '' is foreign content.
		expect(parsed.foreignLines).toEqual(['; note', '']);
	});
});
