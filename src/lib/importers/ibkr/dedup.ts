/**
 * IBKR duplicate rule, as in the Python importer: a candidate duplicates a recorded transaction
 * when the dates are equal and the postings agree as a set of (account, amount to 2 decimals,
 * currency), ignoring the order and `Equity:Currency` postings. Matching is one-to-one.
 * Balance assertions are never reported as duplicates.
 *
 * Unlike the bank rule there is no date window: IBKR dates are exact.
 */
import type { Xact } from '#lib/data/model';
import type { DedupResult } from '../types';

/** Amount in hundredths, as text (`-12.345` -> `-1235`; never `-0`). */
function hundredths(amount: number): string {
	return String(Math.round(amount * 100) || 0);
}

function keyOf(xact: Xact): string | undefined {
	if (!xact.date || xact.balanceAssertion) return undefined;
	const postings = xact.postings
		.filter((p) => !p.account.startsWith('Equity:Currency'))
		.map((p) => JSON.stringify([p.account, p.amount === undefined ? '' : hundredths(p.amount), p.currency]))
		.sort();
	return JSON.stringify([xact.date, postings]);
}

export function matchIbkr(
	candidates: Xact[],
	existing: Xact[]
): { results: DedupResult[]; unmatchedExisting: Xact[] } {
	const recorded = new Map<string, Xact[]>();
	for (const ex of existing) {
		const key = keyOf(ex);
		if (key) recorded.set(key, [...(recorded.get(key) ?? []), ex]);
	}

	const used = new Set<Xact>();
	const results = candidates.map((xact): DedupResult => {
		const key = keyOf(xact);
		const duplicateOf = key ? recorded.get(key)?.shift() : undefined;
		if (duplicateOf) used.add(duplicateOf);
		return { xact, duplicateOf };
	});

	const dates = candidates.filter((c) => !c.balanceAssertion && c.date).map((c) => c.date!);
	const first = dates.reduce((a, b) => (b < a ? b : a), dates[0]);
	const last = dates.reduce((a, b) => (b > a ? b : a), dates[0]);
	const unmatchedExisting = existing.filter(
		(ex) => !used.has(ex) && !!ex.date && ex.date >= first && ex.date <= last
	);
	return { results, unmatchedExisting };
}
