import type { Posting } from '#lib/data/model';
import { listScx, saveScx } from '#lib/services/scxService';
import fullLedgerService from '#lib/services/ledgerWorkerClient';

/**
 * For every scheduled transaction marked as repayment=true, queries the current
 * balance of its Liabilities posting and updates the posting amounts so the
 * forecast reflects the actual amount due.
 *
 * The Liabilities posting receives -balance (positive, reducing the liability).
 * The Assets posting is cleared so XactAugmenter fills it via zero-sum.
 */
export function updateRepaymentAmounts(): Promise<void> {
	// Several components may request this at once (home cards, list page).
	// Share the in-flight run instead of querying and saving twice.
	inFlight ??= doUpdateRepaymentAmounts().finally(() => {
		inFlight = null;
	});
	return inFlight;
}

let inFlight: Promise<void> | null = null;

async function doUpdateRepaymentAmounts(): Promise<void> {
	const scxs = await listScx();
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

		// No rows means no postings on the account, i.e. a valid zero balance.
		// Prefer the first row; if multiple currencies exist take the first.
		const row = (result.rows as unknown[][])[0];
		const balance = row && colBalance !== -1 ? Number(row[colBalance]) || 0 : 0;
		const currency = row && colCurrency !== -1 ? (row[colCurrency] as string) : undefined;

		// balance is negative (liability owed); payment brings it back toward 0.
		// A zero balance yields a zero amount (avoid -0). The currency is kept
		// from the existing posting when there is no balance row to take it from.
		const newAmount = balance === 0 ? 0 : -balance;
		const newCurrency = currency ?? liabPosting.currency;

		// Clear the Assets posting amount so XactAugmenter calculates it via zero-sum.
		const assetsPosting = postings.find((p: Posting) => p.account?.startsWith('Assets:'));

		// Skip the write if nothing changed, so repeated calls are cheap.
		const unchanged =
			liabPosting.amount === newAmount &&
			liabPosting.currency === newCurrency &&
			(!assetsPosting || assetsPosting.amount === undefined);
		if (unchanged) continue;

		liabPosting.amount = newAmount;
		liabPosting.currency = newCurrency;
		if (assetsPosting) {
			assetsPosting.amount = undefined;
		}

		await saveScx(scx);
	}
}
