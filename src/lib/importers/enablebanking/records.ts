/**
 * Pure readings of Enable Banking accounts, balances and transactions.
 */
import type { EbBalance, EbSessionAccount, EbTransaction } from './api';

/** Unique key of an account row; a uid alone may repeat across sessions. */
export function accountKey(sessionId: string, uid: string): string {
	return `${sessionId}:${uid}`;
}

/** What identifies the bank account across sessions; the uid only as a last resort. */
export function accountIdentity(account: EbSessionAccount): string {
	return account.identification_hash || account.uid;
}

export function accountIban(account: EbSessionAccount): string {
	return account.account_id?.iban ?? account.account_id?.other?.identification ?? '';
}

export function accountLabel(account: EbSessionAccount): string {
	return account.name || account.details || accountIban(account) || account.uid;
}

/** ISO 20022 balance type codes, most useful for display first. */
const BALANCE_PREFERENCE = ['CLBD', 'ITBD', 'ITAV', 'CLAV', 'XPCD', 'OPBD', 'OPAV', 'PRCD'];

const BALANCE_LABELS: Record<string, string> = {
	CLAV: 'closing available',
	CLBD: 'closing booked',
	FWAV: 'forward available',
	INFO: 'information',
	ITAV: 'interim available',
	ITBD: 'interim booked',
	OPAV: 'opening available',
	OPBD: 'opening booked',
	OTHR: 'other',
	PRCD: 'previously closed',
	VALU: 'value date',
	XPCD: 'expected'
};

/** The balance to display: the most preferred type present, else the first. */
export function displayBalance(balances: EbBalance[] | undefined): EbBalance | null {
	if (!balances?.length) return null;
	for (const type of BALANCE_PREFERENCE) {
		const match = balances.find((b) => b.balance_type === type);
		if (match) return match;
	}
	return balances[0];
}

export function balanceLabel(type: string): string {
	return BALANCE_LABELS[type] ?? type;
}

/** The signed amount: DBIT (money out) is negative. */
export function txAmount(t: EbTransaction): number | null {
	const n = parseFloat(t.transaction_amount?.amount ?? t.amount ?? '');
	if (!Number.isFinite(n)) return null;
	return t.credit_debit_indicator === 'DBIT' ? -n : n;
}

export function txCurrency(t: EbTransaction): string {
	return t.transaction_amount?.currency ?? t.currency ?? '';
}

/** The other party: the debtor of incoming money, the creditor of outgoing. */
export function txPayee(t: EbTransaction): string {
	if (t.credit_debit_indicator === 'CRDT') return t.debtor?.name ?? '';
	if (t.credit_debit_indicator === 'DBIT') return t.creditor?.name ?? '';
	return t.creditor?.name ?? t.debtor?.name ?? '';
}

export function txNarration(t: EbTransaction): string {
	const info = t.remittance_information;
	if (Array.isArray(info)) return info.join(' ');
	return info ?? '';
}

export function txDate(t: EbTransaction): string {
	return t.booking_date ?? t.value_date ?? t.transaction_date ?? '';
}

/** Only booked transactions are final: the ledger import must take these alone. */
export function isBooked(t: EbTransaction): boolean {
	return t.status === 'BOOK';
}

/**
 * The identity of a transaction for deduplication. `entry_reference` is unique
 * only within accounts sharing an identification hash. It is optional, so the
 * fallback is a fingerprint of the content; identical purchases share a
 * fingerprint, so an importer must compare occurrence counts, not mere
 * presence. `transaction_id` is not used: it may change between fetches.
 */
export function transactionDedupKey(identificationHash: string, t: EbTransaction): string {
	if (t.entry_reference) return JSON.stringify(['ref', identificationHash, t.entry_reference]);
	return JSON.stringify([
		'content',
		identificationHash,
		txDate(t),
		txAmount(t),
		txCurrency(t),
		txPayee(t),
		txNarration(t)
	]);
}
