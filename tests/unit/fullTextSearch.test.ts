/*
    Tests for the OPFS full-text search: term parsing, matching, and the
    OPFS walk (against a fake directory tree).
*/
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	loadSearchableFiles,
	parseSearchTerms,
	searchInFiles,
	type SearchFile
} from '$lib/utils/fullTextSearch';

const file = (path: string, ...lines: string[]): SearchFile => ({ path, lines });

describe('parseSearchTerms', () => {
	it('splits on whitespace and lower-cases', () => {
		expect(parseSearchTerms('  Checking   2026 ')).toEqual([
			{ value: 'checking', scope: 'any' },
			{ value: '2026', scope: 'any' }
		]);
	});

	it('recognises file:/path: prefixes case-insensitively', () => {
		expect(parseSearchTerms('file:2026 PATH:Books')).toEqual([
			{ value: '2026', scope: 'path' },
			{ value: 'books', scope: 'path' }
		]);
	});

	it('treats a bare prefix as an ordinary term', () => {
		expect(parseSearchTerms('file:')).toEqual([{ value: 'file:', scope: 'any' }]);
	});

	it('returns nothing for blank input', () => {
		expect(parseSearchTerms('   ')).toEqual([]);
	});
});

describe('searchInFiles', () => {
	const files = [
		file('books/2025.bean', '2025-08-10 * "Shop"', '  Assets:Checking  -10 EUR', 'unrelated'),
		file('books/2026.bean', '2026-01-02 * "Landlord"', '  Assets:Checking  -900 EUR')
	];

	it('returns nothing without terms', () => {
		expect(searchInFiles(files, [])).toEqual([]);
	});

	it('matches case-insensitively with 1-indexed line and column', () => {
		const matches = searchInFiles(files, parseSearchTerms('LANDLORD'));

		expect(matches).toEqual([
			{ path: 'books/2026.bean', line: 1, col: 15, text: '2026-01-02 * "Landlord"' }
		]);
	});

	it('requires every term on the same line', () => {
		const matches = searchInFiles(files, parseSearchTerms('checking -900'));

		expect(matches.map((m) => [m.path, m.line])).toEqual([['books/2026.bean', 2]]);
	});

	it('lets a plain term match the file path instead of the line', () => {
		const matches = searchInFiles(files, parseSearchTerms('checking 2026'));

		expect(matches.map((m) => [m.path, m.line])).toEqual([['books/2026.bean', 2]]);
	});

	it('reports the earliest matching term as the column', () => {
		const matches = searchInFiles(files, parseSearchTerms('eur checking'));

		expect(matches[0].col).toBe(10); // 'checking' precedes 'EUR' on the line
	});

	it('restricts file:/path: terms to the path', () => {
		// "2026" appears in a 2026-dated line in both scopes; only the file name may satisfy file:
		const matches = searchInFiles(
			[file('books/2025.bean', '2026-03-03 * "Future dated"'), files[1]],
			parseSearchTerms('file:2026')
		);

		expect(matches.map((m) => m.path)).toEqual(['books/2026.bean', 'books/2026.bean']);
	});

	it('combines a path term with a line term', () => {
		const matches = searchInFiles(files, parseSearchTerms('file:2025 shop'));

		expect(matches.map((m) => [m.path, m.line])).toEqual([['books/2025.bean', 1]]);
	});

	it('stops at the limit', () => {
		const many = [file('a.bean', ...Array.from({ length: 20 }, () => 'match'))];

		expect(searchInFiles(many, parseSearchTerms('match'), 5)).toHaveLength(5);
	});

	// TODO: a path-only query (all terms file:/path:) matches every line of matching files,
	// hitting the limit quickly on big files. Confirm that's the wanted behaviour.
});

describe('loadSearchableFiles', () => {
	afterEach(() => vi.unstubAllGlobals());

	const fileHandle = (content: string, fail = false) => ({
		kind: 'file' as const,
		getFile: async () => {
			if (fail) throw new Error('locked');
			return { text: async () => content };
		}
	});
	const dirHandle = (children: Record<string, unknown>): unknown => ({
		kind: 'directory' as const,
		entries: async function* () {
			for (const entry of Object.entries(children)) yield entry;
		}
	});

	it('walks OPFS recursively, keeping only searchable files, sorted by path', async () => {
		const root = dirHandle({
			'z.txt': fileHandle('last'),
			'photo.png': fileHandle('binary'),
			noextension: fileHandle('x'),
			'.cashier': dirHandle({ 'cache.json': fileHandle('{}') }),
			books: dirHandle({
				'main.BEAN': fileHandle('line1\r\nline2\nline3\rline4'),
				'broken.bean': fileHandle('', true)
			})
		});
		vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
		const progress = vi.fn();

		const files = await loadSearchableFiles(progress);

		expect(files.map((f) => f.path)).toEqual(['books/main.BEAN', 'z.txt']);
		expect(files[0].lines).toEqual(['line1', 'line2', 'line3', 'line4']);
		expect(progress).toHaveBeenCalledTimes(2);
		expect(progress).toHaveBeenLastCalledWith({ count: 2, path: 'books/main.BEAN' });
	});
});
