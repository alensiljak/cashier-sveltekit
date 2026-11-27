/*
    Tests for BQL string-literal quoting. The rustledger BQL lexer has no escape
    sequences: `\` is ordinary, `\"` does not escape a quote, and `''` stays two
    characters — so quoting must switch delimiters, never escape. These only pin
    the output text; bql.integration.test.ts runs it through the engine.
*/
import { describe, expect, it } from 'vitest';
import { BQL_NEVER_MATCH, bqlStringLiteral, bqlStringLiteralOrNeverMatch } from '#lib/utils/bql';

describe('bqlStringLiteral', () => {
	it('double-quotes by default', () => {
		expect(bqlStringLiteral('VTI')).toBe('"VTI"');
	});

	it('keeps backslashes verbatim (the ~ regex compiles the literal as-is)', () => {
		expect(bqlStringLiteral('a\\b')).toBe('"a\\b"');
		expect(bqlStringLiteral('\\d+')).toBe('"\\d+"');
	});

	it('switches to single quotes when the value contains a double quote', () => {
		expect(bqlStringLiteral('a"b')).toBe("'a\"b'");
	});

	it('keeps single quotes inside a double-quoted literal', () => {
		expect(bqlStringLiteral("a'b")).toBe('"a\'b"');
	});

	it('returns null when the value contains both quote characters (unrepresentable)', () => {
		expect(bqlStringLiteral('a"b\'c')).toBeNull();
	});
});

describe('bqlStringLiteralOrNeverMatch', () => {
	it('falls back to a never-matching literal for unquotable values', () => {
		expect(bqlStringLiteralOrNeverMatch('a"b\'c')).toBe(BQL_NEVER_MATCH);
		expect(BQL_NEVER_MATCH).toBe('"[^\\s\\S]"');
	});

	it('quotes normal values like bqlStringLiteral', () => {
		expect(bqlStringLiteralOrNeverMatch('(?i)vti')).toBe('"(?i)vti"');
	});
});
