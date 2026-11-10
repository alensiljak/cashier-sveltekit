import { Xact } from '#lib/data/model';
import { getXactStore } from '#lib/storage/xactStoreRegistry';

export interface BalanceAssertionInput {
	account: string;
	/** The assertion's own date; Beancount checks it at the start of this day. */
	date: string;
	amount: number;
	currency: string;
}

/**
 * Writes a `balance` assertion to the working set. Pass `editing` to update an
 * existing record instead of appending a new one. Returns the saved transaction.
 */
export async function saveBalanceAssertion(
	input: BalanceAssertionInput,
	editing?: { id: string; xact: Xact }
): Promise<Xact> {
	const currency = input.currency.trim().toUpperCase();
	const tx = editing ? editing.xact : new Xact();
	tx.date = input.date;
	tx.payee = 'Balance assertion';
	tx.note = `${input.account} = ${input.amount} ${currency}`;
	tx.postings = [];
	tx.balanceAssertion = { account: input.account, amount: input.amount, currency };

	const store = await getXactStore();
	if (editing) await store.updateXact(editing.id, tx);
	else await store.appendMany([tx]);
	return tx;
}
