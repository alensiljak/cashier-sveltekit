/*
    Account Transactions
*/

import { Money } from '$lib/data/model.js';
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

	const account = await fullLedgerService.getAccountWithBalances(params.accountName);
	if (!account) {
		throw new Error('Account not found!');
	}

	// take the first balance
	if (!account.balances) {
		throw new Error('Account has no balances!');
	}
	const total: Money = new Money();
	total.quantity = account?.balances[Object.keys(account.balances)[0]] ?? 0;
	total.currency = Object.keys(account.balances)[0] ?? '';

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
	const dateIdx = columns.indexOf('date');
	const payeeIdx = columns.indexOf('payee');
	const narrationIdx = columns.indexOf('narration');
	const numberIdx = columns.indexOf('number');
	const currencyIdx = columns.indexOf('currency');

	const ledgerNormalized: UnifiedXact[] = (rows as unknown[][]).map((row) => ({
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
