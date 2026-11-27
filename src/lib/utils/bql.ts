/*
	BQL string-literal quoting for the rustledger WASM engine.

	The BQL lexer has NO escape sequences (checked against the engine in
	tests/unit/bql.integration.test.ts): `\` is an ordinary character,
	`\"` does not escape a quote (the literal still ends at the `"`), and `''`
	stays two characters inside a single-quoted literal. A literal therefore ends
	at the first occurrence of its own delimiter, so the only safe quoting is to
	pick a delimiter that does not occur in the value. Backslashes must be passed
	through untouched — the `~` operator compiles the literal verbatim into a
	regex, so doubling them would corrupt patterns like `\d+`.
*/

/** A regex literal that can never match, for values containing both quote characters. */
export const BQL_NEVER_MATCH = '"[^\\s\\S]"';

/**
 * Escapes regex metacharacters, for matching literal text with `~`. Apply it to the
 * text before quoting. Not part of the quoting, since some inputs are meant as regexes.
 */
export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Quotes `value` as a BQL string literal, choosing a delimiter that does not occur
 * in `value`. Returns null when `value` contains both `"` and `'`: no literal can
 * hold that text as is. (A regex could spell `"` as `\x22`, but this function also
 * quotes plain strings, so it does not rewrite the value.)
 */
export function bqlStringLiteral(value: string): string | null {
	if (!value.includes('"')) return `"${value}"`;
	if (!value.includes("'")) return `'${value}'`;
	return null;
}

/** Like `bqlStringLiteral`, but falls back to a never-matching literal for unquotable values. */
export function bqlStringLiteralOrNeverMatch(value: string): string {
	return bqlStringLiteral(value) ?? BQL_NEVER_MATCH;
}
