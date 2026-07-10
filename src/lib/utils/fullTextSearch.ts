/*
	Full-text search across the plain-text files kept in OPFS: Beancount
	sources, the asset-allocation TOML, and any other config/notes files a
	user has synced in. Used by the /search/full-text page.
*/

/** File extensions considered searchable, lower-cased, including the leading dot. */
export const SEARCHABLE_EXTENSIONS = [
	'.bean',
	'.beancount',
	'.toml',
	'.yaml',
	'.yml',
	'.txt',
	'.md',
	'.cfg',
	'.ini',
	'.json'
] as const;

export interface SearchFile {
	/** Path relative to the OPFS root, e.g. "books/2024.bean". */
	path: string;
	lines: string[];
}

export interface SearchMatch {
	path: string;
	/** 1-indexed line number. */
	line: number;
	/** 1-indexed column of the earliest matching term on the line. */
	col: number;
	/** Full text of the matching line. */
	text: string;
}

function isSearchableName(name: string): boolean {
	const dot = name.lastIndexOf('.');
	if (dot === -1) return false;
	const ext = name.slice(dot).toLowerCase();
	return (SEARCHABLE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Recursively reads every searchable file out of OPFS. Directories whose
 * name starts with "." (e.g. `.cashier`, the internal cache folder) are
 * skipped, matching the convention used by the ledger worker's file walk.
 */
export async function loadSearchableFiles(): Promise<SearchFile[]> {
	const root = await navigator.storage.getDirectory();
	const files: SearchFile[] = [];

	async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
		for await (const [name, handle] of dir.entries()) {
			if (name.startsWith('.')) continue;
			const path = prefix ? `${prefix}/${name}` : name;

			if (handle.kind === 'directory') {
				await walk(handle as FileSystemDirectoryHandle, path);
			} else if (isSearchableName(name)) {
				try {
					const file = await (handle as FileSystemFileHandle).getFile();
					const content = await file.text();
					files.push({ path, lines: content.split(/\r\n|\r|\n/) });
				} catch {
					// Skip files that can't be read (e.g. mid-write elsewhere).
				}
			}
		}
	}

	await walk(root, '');
	files.sort((a, b) => a.path.localeCompare(b.path));
	return files;
}

/**
 * One parsed search term. Plain terms match either the line text or the
 * file's path (so "checking 2026" finds "Checking" postings inside a file
 * named "2026.bean" even though "2026" never appears in that line). A
 * `file:`/`path:` prefix narrows a term to the path only, so it doesn't
 * also match the term against unrelated line content — e.g. `file:2026`
 * won't pull in a "2026-…" date from a differently-named file.
 */
export interface SearchTerm {
	/** Lower-cased term text, prefix stripped. */
	value: string;
	/** "path" (from a `file:`/`path:` prefix) restricts matching to the file path. */
	scope: 'any' | 'path';
}

const SCOPE_PREFIX = /^(?:file|path):(.+)$/i;

/** Splits a search box value on whitespace into parsed, lower-cased terms. */
export function parseSearchTerms(searchTerm: string): SearchTerm[] {
	return searchTerm
		.split(/\s+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 0)
		.map((raw) => {
			const prefixed = SCOPE_PREFIX.exec(raw);
			if (prefixed && prefixed[1]) {
				return { value: prefixed[1].toLowerCase(), scope: 'path' as const };
			}
			return { value: raw.toLowerCase(), scope: 'any' as const };
		});
}

/**
 * Finds every line across `files` that satisfies every term (case-insensitive,
 * plain substring). A term matches a line when the line's text contains it,
 * or — for "any"-scoped terms — when the file's path contains it instead;
 * "path"-scoped terms (`file:`/`path:` prefix) only ever match the path.
 * Stops once `limit` matches have been collected so a broad query on a large
 * book stays fast.
 */
export function searchInFiles(
	files: SearchFile[],
	terms: SearchTerm[],
	limit = 300
): SearchMatch[] {
	if (terms.length === 0) return [];
	const results: SearchMatch[] = [];

	outer: for (const file of files) {
		const lowerPath = file.path.toLowerCase();
		const pathMatches = terms.map((term) => lowerPath.includes(term.value));

		// A path-scoped term that doesn't match this file's name rules out
		// every line in it — skip the file without scanning its lines.
		if (terms.some((term, i) => term.scope === 'path' && !pathMatches[i])) continue;

		for (let i = 0; i < file.lines.length; i++) {
			const line = file.lines[i];
			const lower = line.toLowerCase();
			let firstIdx = -1;
			let matchedAll = true;

			for (let t = 0; t < terms.length; t++) {
				const term = terms[t];
				if (term.scope === 'path') continue; // already confirmed at file level

				const idx = lower.indexOf(term.value);
				if (idx === -1) {
					if (pathMatches[t]) continue; // satisfied via the filename instead
					matchedAll = false;
					break;
				}
				if (firstIdx === -1 || idx < firstIdx) firstIdx = idx;
			}

			if (matchedAll) {
				results.push({
					path: file.path,
					line: i + 1,
					col: firstIdx === -1 ? 1 : firstIdx + 1,
					text: line
				});
				if (results.length >= limit) break outer;
			}
		}
	}

	return results;
}
