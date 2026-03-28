/*
    Source-span-based editing for Beancount directives.

    Since @rustledger/wasm ParsedLedger is immutable (no mutation API),
    editing requires working at the source text level. This module uses
    getDocumentSymbols() to map directives to their exact line ranges,
    enabling surgical text replacement that preserves comments, whitespace,
    and formatting of all untouched directives.
*/

import type { ParsedLedger, EditorDocumentSymbol } from '@rustledger/wasm';

export interface DirectiveSpan {
	symbolIndex: number;
	startLine: number; // 0-based inclusive
	endLine: number;   // 0-based inclusive
	sourceText: string;
}

/**
 * Map each top-level document symbol to its source line range.
 * Uses getDocumentSymbols() for accurate positions from the WASM parser.
 */
export function mapDirectiveSpans(
	source: string,
	ledger: ParsedLedger
): DirectiveSpan[] {
	const lines = source.split('\n');
	const symbols: EditorDocumentSymbol[] = ledger.getDocumentSymbols();

	return symbols.map((sym, idx) => {
		const startLine = sym.range.start_line;
		let endLine = sym.range.end_line;

		// Clamp: if the next symbol exists, our span must end before it starts.
		if (idx + 1 < symbols.length) {
			const nextStart = symbols[idx + 1].range.start_line;
			if (endLine >= nextStart) {
				endLine = nextStart - 1;
			}
		}

		// Trim trailing blank lines from the span
		while (endLine > startLine && lines[endLine].trim() === '') {
			endLine--;
		}

		const spanLines = lines.slice(startLine, endLine + 1);
		return {
			symbolIndex: idx,
			startLine,
			endLine,
			sourceText: spanLines.join('\n')
		};
	});
}

/**
 * Replace a single directive's source text by its span index.
 * Returns the modified full source with only the targeted directive changed.
 */
export function replaceDirectiveBySpan(
	source: string,
	spans: DirectiveSpan[],
	spanIndex: number,
	newText: string
): string {
	if (spanIndex < 0 || spanIndex >= spans.length) {
		throw new Error(`Span index ${spanIndex} out of range (0..${spans.length - 1})`);
	}

	const span = spans[spanIndex];
	const lines = source.split('\n');

	// Replace the lines covered by this span
	const before = lines.slice(0, span.startLine);
	const after = lines.slice(span.endLine + 1);

	return [...before, newText, ...after].join('\n');
}

/**
 * Find the span index that corresponds to a given directive index.
 *
 * Document symbols and directives may not be 1:1 (symbols can include
 * non-directive items like options). This finds the best match by
 * comparing the symbol kind and position against the directive's date
 * and type.
 *
 * For simple cases where symbols and directives align, this returns
 * the same index. For complex files, it does a positional match.
 */
export function findSpanForDirective(
	spans: DirectiveSpan[],
	directiveIndex: number,
	source: string,
	directives: { date: string; type: string }[]
): number {
	if (directiveIndex < 0 || directiveIndex >= directives.length) {
		return -1;
	}

	const directive = directives[directiveIndex];

	// Try direct index first (common case)
	if (directiveIndex < spans.length) {
		const span = spans[directiveIndex];
		if (span.sourceText.startsWith(directive.date)) {
			return directiveIndex;
		}
	}

	// Fallback: search by matching the directive's date at the span start
	for (let i = 0; i < spans.length; i++) {
		if (spans[i].sourceText.startsWith(directive.date)) {
			// Count how many spans before this also start with the same date
			const precedingWithSameDate = spans
				.slice(0, i)
				.filter(s => s.sourceText.startsWith(directive.date)).length;
			const directivePrecedingWithSameDate = directives
				.slice(0, directiveIndex)
				.filter(d => d.date === directive.date).length;

			if (precedingWithSameDate === directivePrecedingWithSameDate) {
				return i;
			}
		}
	}

	return -1;
}
