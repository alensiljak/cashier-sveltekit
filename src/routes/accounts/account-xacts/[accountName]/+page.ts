/*
    Account Transactions
*/

import { Account, Money } from '$lib/data/model.js';
import ledgerService from '$lib/services/ledgerService.js';
import fullLedgerService from '$lib/services/ledgerWorkerClient';
import { mergeUnifiedRows, type UnifiedXact } from '$lib/utils/unifiedXacts';
import type { MetaValueJson } from '@rustledger/wasm';
import type { PageLoad } from './$types';

export type { UnifiedXact };

export type AccountMeta = Record<string, MetaValueJson>;

export const load: PageLoad = async ({ params }) => {
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
	const xactsWithSpans = await ledgerService.getXactsWithSpans();
	const deviceXacts = xactsWithSpans.filter(({ xact }) =>
		xact.postings?.some((p) => p.account === params.accountName)
	);

	// Full ledger transactions for this account
	const bql = `SELECT id, date, payee, narration, number, currency \
WHERE account = '${params.accountName}'`;
	const { columns, rows, errors } = await fullLedgerService.query(bql);
	if (errors?.length) console.warn('Ledger xact query errors:', errors);

	// Normalize device xacts
	const deviceRows: UnifiedXact[] = deviceXacts.map(({ xact, span }) => {
		const posting = xact.postings?.find((p) => p.account === params.accountName);
		return {
			date: xact.date ?? '',
			payee: xact.payee ?? '',
			narration: xact.note ?? '',
			amount: posting?.amount ?? 0,
			currency: posting?.currency ?? '',
			isDevice: true,
			xact,
			span
		};
	});

	// Normalize ledger rows
	const safeColumns: string[] = columns ?? [];
	const safeRows = (rows ?? []) as unknown[][];
	const idIdx = safeColumns.indexOf('id');
	const dateIdx = safeColumns.indexOf('date');
	const payeeIdx = safeColumns.indexOf('payee');
	const narrationIdx = safeColumns.indexOf('narration');
	const numberIdx = safeColumns.indexOf('number');
	const currencyIdx = safeColumns.indexOf('currency');

	const ledgerNormalized: UnifiedXact[] = safeRows.map((row) => ({
		id: row[idIdx] as number,
		date: row[dateIdx] as string,
		payee: row[payeeIdx] as string,
		narration: row[narrationIdx] as string,
		amount: parseFloat(row[numberIdx] as string),
		currency: row[currencyIdx] as string,
		isDevice: false
	}));

	// Merge and sort descending by date
	const unifiedRows = mergeUnifiedRows(deviceRows, ledgerNormalized);

	const hasDeviceXacts = deviceRows.length > 0;

	// Extract metadata from the account's open directive
	const directives = await fullLedgerService.getDirectives();
	const openDirective = directives.find(
		(d) =>
			(d as { type: string }).type === 'open' &&
			(d as { account: string }).account === params.accountName
	) as { meta?: AccountMeta } | undefined;
	const accountMeta: AccountMeta = openDirective?.meta ?? {};

	return { account, total, unifiedRows, hasDeviceXacts, accountMeta };
};
