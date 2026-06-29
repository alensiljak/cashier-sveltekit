import db from '$lib/data/db';
import { saveScheduledTransaction } from '$lib/data/dbdal';
import type { Posting } from '$lib/data/model';
import fullLedgerService from '$lib/services/ledgerWorkerClient';

/**
 * For every scheduled transaction marked as repayment=true, queries the current
 * balance of its Liabilities posting and updates the posting amounts so the
 * forecast reflects the actual amount due.
 *
 * The Liabilities posting receives -balance (positive, reducing the liability).
 * The Assets posting is cleared so XactAugmenter fills it via zero-sum.
 */
export async function updateRepaymentAmounts(): Promise<void> {
	const scxs = await db.scheduled.toArray();
	const repaymentScxs = scxs.filter((s) => s.repayment);
	if (!repaymentScxs.length) return;

	for (const scx of repaymentScxs) {
		const postings = scx.transaction?.postings;
		if (!postings?.length) continue;

		const liabPosting = postings.find((p: Posting) => p.account?.startsWith('Liabilities:'));
		if (!liabPosting) continue;

		const bql = `SELECT sum(number) as balance, currency WHERE account ~ '^${liabPosting.account}' GROUP BY currency`;
		const result = await fullLedgerService.query(bql);

		const colBalance = result.columns.indexOf('balance');
		const colCurrency = result.columns.indexOf('currency');
		if (!result.rows.length || colBalance === -1) continue;

		// Prefer the first row; if multiple currencies exist take the first.
		const row = (result.rows as unknown[][])[0];
		const balance = Number(row[colBalance]) || 0;
		const currency = row[colCurrency] as string;

		if (balance === 0) continue;

		// balance is negative (liability owed); payment brings it back toward 0.
		liabPosting.amount = -balance;
		liabPosting.currency = currency;

		// Clear the Assets posting amount so XactAugmenter calculates it via zero-sum.
		const assetsPosting = postings.find((p: Posting) => p.account?.startsWith('Assets:'));
		if (assetsPosting) {
			assetsPosting.amount = undefined;
		}

		await saveScheduledTransaction(scx);
	}
}
