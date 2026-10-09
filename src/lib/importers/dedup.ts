import type { Xact } from '#lib/data/model';
import type { DedupResult } from './types';

/** Bank booking dates lag the actual transaction date; allow this many days of slack. */
export const DEFAULT_DATE_WINDOW_DAYS = 3;

const DAY_MS = 86_400_000;

function daysBetween(a: string, b: string): number {
	return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;
}

/**
 * Whether two transactions touch the bank account with the same amount.
 * Only the bank-side posting is compared: the counter-account is unreliable
 * (an import leaves it as a placeholder, and the user edits it later).
 */
function sameBankPosting(candidate: Xact, existing: Xact, account: string): boolean {
	const a = candidate.postings.find((p) => p.account === account);
	const b = existing.postings.find((p) => p.account === account);
	if (!a || !b || a.amount === undefined || b.amount === undefined) return false;
	return a.currency === b.currency && Math.round(a.amount * 100) === Math.round(b.amount * 100);
}

/** Loose payee comparison, used only to prefer between otherwise equal matches ("Ikea" ~ "IKEA WIEN NORD"). */
function payeesAlike(a: Xact, b: Xact): boolean {
	const x = (a.payee ?? '').trim().toLowerCase();
	const y = (b.payee ?? '').trim().toLowerCase();
	return x !== '' && y !== '' && (x.includes(y) || y.includes(x));
}

/**
 * Marks candidates that already exist. Matching is one-to-one: each existing
 * transaction can absorb at most one candidate. Pairs are assigned closest date
 * first (then similar payee first), so identical amounts on nearby days pair with
 * their own booking rather than with whichever candidate is processed first.
 * The payee never decides whether something is a duplicate, only which of several
 * equal candidates it is.
 *
 * @param account The bank account the file belongs to.
 * @param existing Transactions already recorded.
 */
export function findDuplicates(
	candidates: Xact[],
	existing: Xact[],
	account: string,
	windowDays = DEFAULT_DATE_WINDOW_DAYS
): DedupResult[] {
	const pairs: { c: number; e: number; distance: number; alike: boolean }[] = [];
	candidates.forEach((cand, c) => {
		if (!cand.date) return;
		existing.forEach((ex, e) => {
			if (!ex.date) return;
			const distance = daysBetween(cand.date!, ex.date);
			if (distance > windowDays || !sameBankPosting(cand, ex, account)) return;
			pairs.push({ c, e, distance, alike: payeesAlike(cand, ex) });
		});
	});
	pairs.sort((p, q) => p.distance - q.distance || Number(q.alike) - Number(p.alike));

	const matched = new Map<number, Xact>();
	const usedExisting = new Set<number>();
	for (const { c, e } of pairs) {
		if (matched.has(c) || usedExisting.has(e)) continue;
		matched.set(c, existing[e]);
		usedExisting.add(e);
	}

	return candidates.map((xact, c) => ({ xact, duplicateOf: matched.get(c) }));
}
