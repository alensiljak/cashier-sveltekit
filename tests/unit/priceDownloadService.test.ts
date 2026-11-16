/*
    Pure helpers of the Price Download service: include resolution (for the
    "destination is not wired into the book" hint) and user-facing errors.
*/
import { describe, expect, it } from 'vitest';
import { describeError, resolveIncludes } from '#lib/services/prices/priceDownloadService';

describe('resolveIncludes', () => {
	it('resolves relative includes against the including file directory', () => {
		const text = 'include "prices/prices.current.bean"\ninclude "../shared/a.bean"\n';
		expect(resolveIncludes('books/main.bean', text)).toEqual([
			'books/prices/prices.current.bean',
			'shared/a.bean'
		]);
	});

	it('handles a book at the OPFS root', () => {
		expect(resolveIncludes('book.bean', 'include "prices/p.bean"')).toEqual(['prices/p.bean']);
	});

	it('ignores commented-out includes and other directives', () => {
		const text = '; include "a.bean"\n2026-01-01 open Assets:Cash EUR\n  include "b.bean"\n';
		expect(resolveIncludes('book.bean', text)).toEqual(['b.bean']);
	});
});

describe('describeError', () => {
	it('words a failed fetch (TypeError) as a connectivity problem', () => {
		expect(describeError(new TypeError('Failed to fetch'))).toMatch(/Could not reach/);
	});

	it('passes through ordinary error messages without the Error: prefix', () => {
		expect(describeError(new Error('ECB response is not a non-empty array'))).toBe(
			'ECB response is not a non-empty array'
		);
		expect(describeError('boom')).toBe('boom');
	});
});
