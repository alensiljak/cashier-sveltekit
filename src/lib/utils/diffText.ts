import { diffLines } from 'diff';

export type DiffLine = { type: 'added' | 'removed' | 'context'; content: string };
export type DiffSection = { filename: string; lines: DiffLine[]; identical: boolean };

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			out[key] = sortKeys((value as Record<string, unknown>)[key]);
		}
		return out;
	}
	return value;
}

/**
 * Re-serializes JSON text in a canonical form (2-space indent, object keys sorted
 * recursively, array order kept) so a line diff shows only the values that differ,
 * not formatting or key-order noise. Returns null when the text is not valid JSON.
 */
export function canonicalizeJson(text: string): string | null {
	try {
		return JSON.stringify(sortKeys(JSON.parse(text)), null, 2);
	} catch {
		return null;
	}
}

/**
 * Builds a line-level diff between two texts.
 *
 * Semantics follow the underlying `diffLines(oldText, newText)`: a line is
 * `added` if it only appears in `newText`, `removed` if it only appears in
 * `oldText`, and `context` otherwise. Cross-platform EOL noise (CRLF vs LF,
 * trailing newline at EOF) is ignored so an Android/Windows byte difference
 * with no real content change doesn't render as a spurious replaced line.
 */
export function buildDiffLines(oldText: string, newText: string): DiffLine[] {
	const changes = diffLines(oldText, newText, {
		stripTrailingCr: true,
		ignoreNewlineAtEof: true
	});
	const lines: DiffLine[] = [];
	for (const part of changes) {
		const partLines = part.value.split('\n');
		if (partLines[partLines.length - 1] === '') partLines.pop();
		const type = part.added ? 'added' : part.removed ? 'removed' : 'context';
		for (const content of partLines) lines.push({ type, content });
	}
	return lines;
}
