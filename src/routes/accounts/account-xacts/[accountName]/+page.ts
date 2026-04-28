/*
    Account Transactions
*/

import { Account, Money } from '$lib/data/model.js';
import ledgerService from '$lib/services/ledgerService.js';
import fullLedgerService from '$lib/services/ledgerWorkerClient';

export type UnifiedXact = {
	date: string;
	payee: string;
	narration: string;
	amount: number;
	currency: string;
	isDevice: boolean;
};

export async function load({ params }) {
	if (!params.accountName) {
		throw new Error('Account must be specified!');
	}

	const account =
		(await fullLedgerService.getAccountWithBalances(params.accountName)) ??
		new Account(params.accountName);

	// take the first balance
	const total: Money = new Money();
	const balanceKeys = account.balances ? Object.keys(account.balances) : [];
	total.quantity = balanceKeys.length ? account.balances![balanceKeys[0]] : 0;
	total.currency = balanceKeys[0] ?? '';

	// On-device transactions
	await ledgerService.load();
	const xacts = ledgerService
		.getXacts()
		.filter((xact) => xact.postings?.some((p) => p.account === params.accountName));

	// Full ledger transactions for this account
	const bql = `SELECT date, payee, narration, number, currency \
WHERE account = '${params.accountName}' ORDER BY date DESC`;
	const { columns, rows, errors } = await fullLedgerService.query(bql);
	if (errors?.length) console.warn('Ledger xact query errors:', errors);

	// Normalize device xacts
	const deviceRows: UnifiedXact[] = xacts.map((xact) => {
		const posting = xact.postings?.find((p) => p.account === params.accountName);
		return {
			date: xact.date ?? '',
			payee: xact.payee ?? '',
			narration: xact.note ?? '',
			amount: posting?.amount ?? 0,
			currency: posting?.currency ?? '',
			isDevice: true
		};
	});

	// Normalize ledger rows
	const safeColumns: string[] = columns ?? [];
	const safeRows = (rows ?? []) as unknown[][];
	const dateIdx = safeColumns.indexOf('date');
	const payeeIdx = safeColumns.indexOf('payee');
	const narrationIdx = safeColumns.indexOf('narration');
	const numberIdx = safeColumns.indexOf('number');
	const currencyIdx = safeColumns.indexOf('currency');

	const ledgerNormalized: UnifiedXact[] = safeRows.map((row) => ({
		date: row[dateIdx] as string,
		payee: row[payeeIdx] as string,
		narration: row[narrationIdx] as string,
		amount: parseFloat(row[numberIdx] as string),
		currency: row[currencyIdx] as string,
		isDevice: false
	}));

	// Mark ledger rows that match a device row, then add only unmatched device rows
	const unmatchedDeviceRows: UnifiedXact[] = [];
	for (const dr of deviceRows) {
		const matchIdx = ledgerNormalized.findIndex(
			(lr) =>
				lr.date === dr.date &&
				lr.payee === dr.payee &&
				lr.amount === dr.amount &&
				lr.currency === dr.currency
		);
		if (matchIdx !== -1) {
			ledgerNormalized[matchIdx].isDevice = true;
		} else {
			unmatchedDeviceRows.push(dr);
		}
	}

	// Merge and sort descending by date
	const unifiedRows = [...unmatchedDeviceRows, ...ledgerNormalized].sort((a, b) =>
		b.date.localeCompare(a.date)
	);

	const hasDeviceXacts = deviceRows.length > 0;

	return { account, total, unifiedRows, hasDeviceXacts };
}
