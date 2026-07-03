/*
    Payee Transactions
*/

import ledgerService from '$lib/services/ledgerService.js';
import fullLedgerService from '$lib/services/ledgerWorkerClient';
import { mergeUnifiedRows, type UnifiedXact } from '$lib/utils/unifiedXacts';
import type { PageLoad } from './$types';

export type { UnifiedXact };

export const load: PageLoad = async ({ params }) => {
	if (!params.payeeName) {
		throw new Error('Payee must be specified!');
	}
	const payeeName = params.payeeName;

	// On-device transactions. The Payees list uses COALESCE(payee, narration), so
	// match the same way here: an empty payee falls back to the narration.
	await ledgerService.load();
	const xactsWithSpans = await ledgerService.getXactsWithSpans();
	const deviceXacts = xactsWithSpans.filter(
		({ xact }) => (xact.payee || xact.note || '') === payeeName
	);

	// Full ledger transactions. COALESCE(payee, narration) filtering is done in JS below —
	// BQL WHERE clause support for COALESCE against a full-book query is not guaranteed,
	// and this matches the semantics of the Payees list's own COALESCE(payee, narration) query.
	const bql = `SELECT date, payee, narration, account, number, currency`;
	const { columns, rows, errors } = await fullLedgerService.query(bql);
	if (errors?.length) console.warn('Ledger xact query errors:', errors);

	// Normalize device xacts: one row per posting, since a payee's transactions
	// can touch multiple accounts.
	const deviceRows: UnifiedXact[] = deviceXacts.flatMap(({ xact, span }) =>
		(xact.postings ?? []).map((posting) => ({
			date: xact.date ?? '',
			payee: xact.payee ?? '',
			narration: xact.note ?? '',
			amount: posting.amount ?? 0,
			currency: posting.currency ?? '',
			account: posting.account,
			isDevice: true,
			xact,
			span
		}))
	);

	// Normalize ledger rows
	const safeColumns: string[] = columns ?? [];
	const safeRows = (rows ?? []) as unknown[][];
	const dateIdx = safeColumns.indexOf('date');
	const payeeIdx = safeColumns.indexOf('payee');
	const narrationIdx = safeColumns.indexOf('narration');
	const accountIdx = safeColumns.indexOf('account');
	const numberIdx = safeColumns.indexOf('number');
	const currencyIdx = safeColumns.indexOf('currency');

	const ledgerNormalized: UnifiedXact[] = safeRows
		.map((row) => ({
			date: row[dateIdx] as string,
			payee: row[payeeIdx] as string,
			narration: row[narrationIdx] as string,
			amount: parseFloat(row[numberIdx] as string),
			currency: row[currencyIdx] as string,
			account: row[accountIdx] as string,
			isDevice: false
		}))
		.filter((row) => (row.payee || row.narration || '') === payeeName);

	// Merge and sort descending by date
	const unifiedRows = mergeUnifiedRows(deviceRows, ledgerNormalized);

	const hasDeviceXacts = deviceRows.length > 0;

	return { payeeName, unifiedRows, hasDeviceXacts };
};
