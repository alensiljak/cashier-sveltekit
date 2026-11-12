import type { Posting, ScheduledTransaction } from '#lib/data/model';
import { listScx } from '#lib/services/scxService';
import fullLedgerService from '#lib/services/ledgerWorkerClient';

/**
 * For every scheduled transaction marked as repayment=true, queries the current
 * balance of its Liabilities posting and sets the posting amounts on the given
 * objects so the forecast reflects the actual amount due.
 *
 * The amounts are derived from the ledger, so they are only applied in memory and
 * never saved: writing them to the scheduled-transactions store would trigger a
 * backup/sync upload on every launch and make devices with different ledger state
 * overwrite each other.
 *
 * The Liabilities posting receives -balance (positive, reducing the liability).
 * The Assets posting is cleared so XactAugmenter fills it via zero-sum.
 */
export async function applyRepaymentAmounts<T extends ScheduledTransaction>(
	scxs: T[]
): Promise<T[]> {
	for (const scx of scxs) {
		if (!scx.repayment) continue;

		const postings = scx.transaction?.postings;
		if (!postings?.length) continue;

		const liabPosting = postings.find((p: Posting) => p.account?.startsWith('Liabilities:'));
		if (!liabPosting) continue;

		try {
			const bql = `SELECT sum(number) as balance, currency WHERE account ~ '^${liabPosting.account}' GROUP BY currency`;
			const result = await fullLedgerService.query(bql);

			const colBalance = result.columns.indexOf('balance');
			const colCurrency = result.columns.indexOf('currency');

			// No rows means no postings on the account, i.e. a valid zero balance.
			// Prefer the first row; if multiple currencies exist take the first.
			const row = (result.rows as unknown[][])[0];
			const balance = row && colBalance !== -1 ? Number(row[colBalance]) || 0 : 0;
			const currency = row && colCurrency !== -1 ? (row[colCurrency] as string) : undefined;

			// balance is negative (liability owed); payment brings it back toward 0.
			// A zero balance yields a zero amount (avoid -0). The currency is kept
			// from the existing posting when there is no balance row to take it from.
			liabPosting.amount = balance === 0 ? 0 : -balance;
			liabPosting.currency = currency ?? liabPosting.currency;

			// Clear the Assets posting amount so XactAugmenter calculates it via zero-sum.
			const assetsPosting = postings.find((p: Posting) => p.account?.startsWith('Assets:'));
			if (assetsPosting) assetsPosting.amount = undefined;
		} catch (error) {
			// Keep the stored amounts for this one; the rest are still computed.
			console.error('Error calculating repayment amount', error);
		}
	}
	return scxs;
}

/** All scheduled transactions, by next date, with the repayment amounts computed from the ledger. */
export async function listScxWithRepayments(): Promise<ScheduledTransaction[]> {
	return applyRepaymentAmounts(await listScx());
}
