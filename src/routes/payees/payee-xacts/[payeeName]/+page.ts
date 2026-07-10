/*
    Payee Transactions
*/

import ledgerService from '$lib/services/ledgerService.js';
import fullLedgerService from '$lib/services/ledgerWorkerClient';
import { Xact, Posting } from '$lib/data/model';
import type { DirectiveSpan } from '$lib/rledger/sourceEditor';
import type { PageLoad } from './$types';

export type PayeeXactRow = {
	xact: Xact;
	span?: DirectiveSpan;
	isDevice: boolean;
};

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

	// Full ledger transactions. cost_number/cost_currency give us the per-unit
	// cost annotation ({} syntax) directly from BQL without loading all directives.
	const bql = `SELECT id, date, flag, payee, narration, account, number, currency,
		cost_number, cost_currency, cost_date, price`;
	const { columns, rows, errors } = await fullLedgerService.query(bql);
	if (errors?.length) console.warn('Ledger xact query errors:', errors);

	const safeColumns: string[] = columns ?? [];
	const safeRows = (rows ?? []) as unknown[][];

	const idIdx = safeColumns.indexOf('id');
	const dateIdx = safeColumns.indexOf('date');
	const flagIdx = safeColumns.indexOf('flag');
	const payeeIdx = safeColumns.indexOf('payee');
	const narrationIdx = safeColumns.indexOf('narration');
	const accountIdx = safeColumns.indexOf('account');
	const numberIdx = safeColumns.indexOf('number');
	const currencyIdx = safeColumns.indexOf('currency');
	const costNumberIdx = safeColumns.indexOf('cost_number');
	const costCurrencyIdx = safeColumns.indexOf('cost_currency');
	const costDateIdx = safeColumns.indexOf('cost_date');
	const priceIdx = safeColumns.indexOf('price');

	// Filter rows to this payee, then group by transaction id to assemble Xact objects.
	const filtered = safeRows.filter(
		(row) => ((row[payeeIdx] as string) || (row[narrationIdx] as string) || '') === payeeName
	);

	const byId = new Map<string, Xact>();
	for (const row of filtered) {
		const id = String(row[idIdx]);
		let x = byId.get(id);
		if (!x) {
			x = new Xact();
			x.date = row[dateIdx] as string;
			x.flag = (row[flagIdx] as string) ?? '*';
			x.payee = (row[payeeIdx] as string) ?? '';
			x.note = (row[narrationIdx] as string) ?? '';
			byId.set(id, x);
		}
		const p = new Posting();
		p.account = row[accountIdx] as string;
		p.amount = parseFloat(row[numberIdx] as string);
		p.currency = row[currencyIdx] as string;
		const costNum = costNumberIdx >= 0 ? row[costNumberIdx] : null;
		if (costNum != null) p.costAmount = parseFloat(String(costNum));
		const costCur = costCurrencyIdx >= 0 ? (row[costCurrencyIdx] as string) : null;
		if (costCur) p.costCurrency = costCur;
		const costDate = costDateIdx >= 0 ? (row[costDateIdx] as string) : null;
		if (costDate) p.costDate = costDate;
		// price is an AmountValue { number: string; currency: string } or null
		const priceVal =
			priceIdx >= 0 ? (row[priceIdx] as { number: string; currency: string } | null) : null;
		if (priceVal?.number != null) p.priceAmount = parseFloat(priceVal.number);
		if (priceVal?.currency) p.priceCurrency = priceVal.currency;
		// BQL price column doesn't distinguish @ vs @@ — isTotalPrice needs raw source.
		// Default to false (per-unit @); device xacts get correct @@ via directiveToXact.
		if (priceVal) p.totalPrice = false;
		x.postings.push(p);
	}

	const ledgerRows: PayeeXactRow[] = Array.from(byId.values()).map((xact) => ({
		xact,
		isDevice: false
	}));

	const deviceRows: PayeeXactRow[] = deviceXacts.map(({ xact, span }) => ({
		xact,
		span,
		isDevice: true
	}));

	// Merge: device rows shadow matching ledger rows (same date/payee/narration).
	const unmatchedLedgerRows = ledgerRows.filter(
		(lr) =>
			!deviceRows.some(
				(dr) =>
					dr.xact.date === lr.xact.date &&
					(dr.xact.payee ?? '') === (lr.xact.payee ?? '') &&
					(dr.xact.note ?? '') === (lr.xact.note ?? '')
			)
	);

	const allRows = [...deviceRows, ...unmatchedLedgerRows].sort((a, b) =>
		(b.xact.date ?? '').localeCompare(a.xact.date ?? '')
	);

	const hasDeviceXacts = deviceRows.length > 0;

	return { payeeName, xacts: allRows, hasDeviceXacts };
};
