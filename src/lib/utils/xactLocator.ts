/*
	Locates transaction directives by source line within an arbitrary
	Beancount source string — the same span-mapping approach
	`ledgerService` uses for cashier.bean, generalized to any file so
	callers (e.g. full-text search) can resolve a matched line to the
	exact transaction that contains it, in any .bean file.
*/
import type { DirectiveJson } from '@rustledger/wasm';
import { Xact } from '$lib/data/model';
import { createParsedLedger, ensureInitialized } from '$lib/services/rustledger';
import { directiveToXact } from '$lib/utils/transactionParser';
import {
	mapDirectiveSpans,
	findSpanForDirective,
	type DirectiveSpan
} from '$lib/rledger/sourceEditor';

export interface XactLocation {
	xact: Xact;
	/** 0-based inclusive line range within the source that was parsed. */
	span: DirectiveSpan;
}

/**
 * Parses `source` and returns every transaction directive paired with its
 * source span. Directive order (chronological, from `getDirectives()`) and
 * symbol order (file order, from `getDocumentSymbols()` via
 * `mapDirectiveSpans`) can diverge, so spans are aligned per directive via
 * `findSpanForDirective` rather than assumed to be index-aligned.
 */
export async function locateXactsInSource(source: string): Promise<XactLocation[]> {
	if (!source.trim()) return [];

	await ensureInitialized();
	const ledger = createParsedLedger(source);
	if (!ledger) return [];

	try {
		const directives: DirectiveJson[] = ledger.getDirectives();
		const spans = mapDirectiveSpans(source, ledger);

		const result: XactLocation[] = [];
		for (let i = 0; i < directives.length; i++) {
			const directive = directives[i];
			if (directive.type !== 'transaction') continue;
			const spanIdx = findSpanForDirective(spans, i, source, directives);
			if (spanIdx >= 0) {
				result.push({ xact: directiveToXact(directive, source), span: spans[spanIdx] });
			}
		}
		return result;
	} finally {
		ledger.free();
	}
}

/** Finds the transaction whose span contains the given 1-based line number, if any. */
export function findXactAtLine(
	locations: XactLocation[],
	line1Based: number
): XactLocation | undefined {
	const line0 = line1Based - 1;
	return locations.find((loc) => line0 >= loc.span.startLine && line0 <= loc.span.endLine);
}
