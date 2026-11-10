/**
 * Local draft of an in-progress reconciliation. Ticks are never written into the book;
 * the draft only lets the user leave the page and resume. It lives in localStorage, so it
 * is per device and is not synced.
 */

export interface ReconcileDraft {
	account: string;
	statementDate: string;
	statementBalance: string;
	currency: string;
	/** Keys of the ticked postings, see {@link postingKeys}. */
	tickedKeys: string[];
}

const KEY_PREFIX = 'cashier.reconcileDraft.';

/**
 * Stable keys for postings, independent of the ledger's internal ids (which may change on
 * reload). Identical postings are told apart by their occurrence number.
 */
export function postingKeys(
	postings: { date: string; payee: string; narration: string; amount: number }[]
): string[] {
	const seen = new Map<string, number>();
	return postings.map((p) => {
		const base = `${p.date}|${p.payee}|${p.narration}|${p.amount}`;
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		return `${base}#${n}`;
	});
}

/** Which postings the draft had ticked. Keys that no longer exist are dropped. */
export function restoreTicks(keys: string[], draftTicked: string[]): boolean[] {
	const set = new Set(draftTicked);
	return keys.map((k) => set.has(k));
}

export function loadDraft(account: string): ReconcileDraft | undefined {
	try {
		const raw = localStorage.getItem(KEY_PREFIX + account);
		if (!raw) return undefined;
		const d = JSON.parse(raw) as ReconcileDraft;
		if (d?.account !== account || !Array.isArray(d.tickedKeys)) return undefined;
		return d;
	} catch {
		return undefined;
	}
}

export function saveDraft(draft: ReconcileDraft): void {
	try {
		localStorage.setItem(KEY_PREFIX + draft.account, JSON.stringify(draft));
	} catch {
		// Storage unavailable or full: the draft is a convenience only.
	}
}

export function clearDraft(account: string): void {
	try {
		localStorage.removeItem(KEY_PREFIX + account);
	} catch {
		// ignore
	}
}
