/*
	Shared row type and helpers for "unified" transaction lists — merging
	on-device (unsaved) transactions with the full ledger's transactions,
	sorted descending by date. Used by Account Transactions and Payee
	Transactions (see TransactionList.svelte), and any future transaction
	list keyed by a different dimension.
*/

import { goto } from '$app/navigation';
import { xact, xactSpan } from '$lib/data/mainStore';
import { Xact, Posting } from '$lib/data/model';
import type { DirectiveSpan } from '$lib/rledger/sourceEditor';
import fullLedgerService from '$lib/services/ledgerWorkerClient';
import Notifier from '$lib/utils/notifier';

export type UnifiedXact = {
	date: string;
	payee: string;
	narration: string;
	amount: number;
	currency: string;
	/** Posting account for this row. Omitted when the list is already scoped to one account. */
	account?: string;
	/** Transaction id from the full ledger. Present on ledger rows; absent on device rows. */
	id?: number;
	isDevice: boolean;
	xact?: Xact;
	span?: DirectiveSpan;
};

/**
 * Merge on-device rows with full-ledger rows: a device row that matches a ledger
 * row (same date/payee/amount/currency/account) marks that ledger row as a device
 * row instead of duplicating it; unmatched device rows are appended. Result is
 * sorted descending by date.
 */
export function mergeUnifiedRows(
	deviceRows: UnifiedXact[],
	ledgerRows: UnifiedXact[]
): UnifiedXact[] {
	const unmatchedDeviceRows: UnifiedXact[] = [];
	for (const dr of deviceRows) {
		const matchIdx = ledgerRows.findIndex(
			(lr) =>
				lr.date === dr.date &&
				lr.payee === dr.payee &&
				lr.amount === dr.amount &&
				lr.currency === dr.currency &&
				lr.account === dr.account
		);
		if (matchIdx !== -1) {
			ledgerRows[matchIdx].isDevice = true;
			ledgerRows[matchIdx].xact = dr.xact;
			ledgerRows[matchIdx].span = dr.span;
		} else {
			unmatchedDeviceRows.push(dr);
		}
	}

	return [...unmatchedDeviceRows, ...ledgerRows].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Open a row's transaction in the Xact editor/details view. Device rows already
 * carry their Xact + source span; read-only (full-ledger) rows are re-fetched by
 * transaction id (preferred) or date/payee/narration to gather every posting.
 */
export async function openXactDetails(row: UnifiedXact): Promise<void> {
	if (row.isDevice && row.xact && row.span) {
		xact.set(row.xact);
		xactSpan.set(row.span);
		await goto('/xact-actions');
		return;
	}

	// Read-only transaction: fetch postings from the full ledger.
	// Prefer id-based lookup (exact) over date/payee/narration (fragile).
	const bql = row.id
		? `SELECT flag, account, number, currency WHERE id = ${row.id}`
		: (() => {
				const payeeClause = row.payee
					? `AND payee = "${row.payee.replace(/"/g, '\\"')}"`
					: `AND payee = ""`;
				const narrationClause = `AND narration = "${(row.narration ?? '').replace(/"/g, '\\"')}"`;
				return `SELECT flag, account, number, currency WHERE date = ${row.date} ${payeeClause} ${narrationClause}`;
			})();

	const { columns, rows: postingRows, errors } = await fullLedgerService.query(bql);
	if (errors?.length) console.warn('Posting query errors:', errors);

	const safeRows = (postingRows ?? []) as unknown[][];
	if (!safeRows.length) {
		Notifier.error('Could not load transaction details');
		return;
	}

	const flagIdx = columns.indexOf('flag');
	const accountIdx = columns.indexOf('account');
	const numberIdx = columns.indexOf('number');
	const currencyIdx = columns.indexOf('currency');

	const xactObj = new Xact();
	xactObj.date = row.date;
	xactObj.payee = row.payee;
	xactObj.note = row.narration;
	xactObj.flag = (safeRows[0][flagIdx] as string) ?? '*';
	xactObj.postings = safeRows.map((pr) => {
		const p = new Posting();
		p.account = pr[accountIdx] as string;
		p.amount = parseFloat(pr[numberIdx] as string);
		p.currency = pr[currencyIdx] as string;
		return p;
	});

	xact.set(xactObj);
	xactSpan.set(undefined);
	await goto('/xact-actions');
}
