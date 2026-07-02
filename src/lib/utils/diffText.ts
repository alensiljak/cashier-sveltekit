import { diffLines } from 'diff';

export type DiffLine = { type: 'added' | 'removed' | 'context'; content: string };
export type DiffSection = { filename: string; lines: DiffLine[]; identical: boolean };

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
