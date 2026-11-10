/**
 * Pure helpers for account reconciliation: comparing the book's balance with a
 * bank statement's closing balance.
 */

/** Differences smaller than this are treated as zero (float noise below one cent). */
export const RECONCILED_TOLERANCE = 0.005;

/** Statement minus book: positive means the bank shows more than the book. */
export function reconciliationDifference(bookBalance: number, statementBalance: number): number {
	const diff = statementBalance - bookBalance;
	return Math.abs(diff) < RECONCILED_TOLERANCE ? 0 : diff;
}

export function isReconciled(bookBalance: number, statementBalance: number): boolean {
	return reconciliationDifference(bookBalance, statementBalance) === 0;
}

export interface BalanceAssertion {
	/** The assertion's own date; it checks the balance at the start of this day. */
	date: string;
	account: string;
	amount: number;
	currency: string;
}

/**
 * The most recent `balance` assertion for `account` in `currency` dated on or before
 * `onOrBefore`. Transactions dated from the assertion's date onwards are the ones
 * that still need reconciling.
 */
export function latestAssertion(
	directives: unknown[],
	account: string,
	currency: string,
	onOrBefore: string
): BalanceAssertion | undefined {
	let best: BalanceAssertion | undefined;
	for (const d of directives as Array<Record<string, unknown>>) {
		if (d.type !== 'balance' || d.account !== account) continue;
		const amount = d.amount as { number?: unknown; currency?: unknown } | undefined;
		if (!amount || amount.currency !== currency) continue;
		const date = String(d.date ?? '');
		if (!date || date > onOrBefore) continue;
		const value = parseFloat(String(amount.number));
		if (isNaN(value)) continue;
		if (!best || date > best.date) best = { date, account, amount: value, currency };
	}
	return best;
}

/**
 * Date of the most recent `balance` assertion for `account` in any currency, or undefined
 * if there is none. Shown as "last reconciled on" so stale accounts stand out.
 */
export function lastAssertionDate(directives: unknown[], account: string): string | undefined {
	let best: string | undefined;
	for (const d of directives as Array<Record<string, unknown>>) {
		if (d.type !== 'balance' || d.account !== account) continue;
		const date = String(d.date ?? '');
		if (date && (!best || date > best)) best = date;
	}
	return best;
}

/** Sum of the amounts at the ticked positions. */
export function sumTicked(amounts: number[], ticked: boolean[]): number {
	return amounts.reduce((sum, amount, i) => (ticked[i] ? sum + amount : sum), 0);
}

/**
 * The date for a `balance` assertion that checks a statement's closing balance.
 * Beancount evaluates an assertion at the start of its day, so a balance at the
 * end of `statementDate` is asserted on the following day.
 */
export function assertionDateFor(statementDate: string): string {
	const d = new Date(`${statementDate}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().substring(0, 10);
}
