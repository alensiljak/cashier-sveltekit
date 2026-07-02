/*
	Full-text search across the plain-text files kept in OPFS: Beancount
	sources, the asset-allocation TOML, and any other config/notes files a
	user has synced in. Used by the /search page.
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

/** Splits a search box value on whitespace into non-empty, lower-cased terms. */
export function splitSearchTerms(searchTerm: string): string[] {
	return searchTerm
		.split(/\s+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 0);
}

/**
 * Finds every line across `files` that contains all `terms` (case-insensitive,
 * plain substring — no regex metacharacters to worry about since arbitrary
 * ledger text, amounts, and account names are searched). Stops once `limit`
 * matches have been collected so a broad query on a large book stays fast.
 */
export function searchInFiles(files: SearchFile[], terms: string[], limit = 300): SearchMatch[] {
	if (terms.length === 0) return [];
	const lowerTerms = terms.map((term) => term.toLowerCase());
	const results: SearchMatch[] = [];

	outer: for (const file of files) {
		for (let i = 0; i < file.lines.length; i++) {
			const line = file.lines[i];
			const lower = line.toLowerCase();
			let firstIdx = -1;
			let matchedAll = true;

			for (const term of lowerTerms) {
				const idx = lower.indexOf(term);
				if (idx === -1) {
					matchedAll = false;
					break;
				}
				if (firstIdx === -1 || idx < firstIdx) firstIdx = idx;
			}

			if (matchedAll) {
				results.push({ path: file.path, line: i + 1, col: firstIdx + 1, text: line });
				if (results.length >= limit) break outer;
			}
		}
	}

	return results;
}
