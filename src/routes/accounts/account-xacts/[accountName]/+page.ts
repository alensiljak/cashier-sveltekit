/*
    Account Transactions
*/

import { Account, Money } from '#lib/data/model.js';
import { getXactStore } from '#lib/storage/xactStoreRegistry';
import fullLedgerService from '#lib/services/ledgerWorkerClient';
import { mergeUnifiedRows, type UnifiedXact } from '#lib/utils/unifiedXacts';
import { lastAssertionDate } from '#lib/reconciliation/reconciliation';
import type { MetaValueJson } from '@rustledger/wasm';
import type { PageLoad } from './$types';

export type { UnifiedXact };

export type AccountMeta = Record<string, MetaValueJson>;

export const load: PageLoad = async ({ params }) => {
	if (!params.accountName) {
		throw new Error('Account must be specified!');
	}

	await fullLedgerService.ensureLoaded();

	const account =
		(await fullLedgerService.getAccountWithBalances(params.accountName)) ??
		new Account(params.accountName);

	// one total per currency held in this account
	const balanceKeys = account.balances ? Object.keys(account.balances) : [];
	const totals: Money[] = balanceKeys.map((currency) => {
		const money = new Money();
		money.quantity = account.balances![currency];
		money.currency = currency;
		return money;
	});

	// On-device transactions
	const storedXacts = await (await getXactStore()).list();
	const deviceXacts = storedXacts.filter(({ xact }) =>
		xact.postings?.some((p) => p.account === params.accountName)
	);

	// Full ledger transactions for this account
	const bql = `SELECT id, flag, date, payee, narration, number, currency \
WHERE account = '${params.accountName}'`;
	const { columns, rows, errors } = await fullLedgerService.query(bql);
	if (errors?.length) console.warn('Ledger xact query errors:', errors);

	// Normalize device xacts
	const deviceRows: UnifiedXact[] = deviceXacts.map(({ xact, id }) => {
		const posting = xact.postings?.find((p) => p.account === params.accountName);
		return {
			date: xact.date ?? '',
			payee: xact.payee ?? '',
			narration: xact.note ?? '',
			amount: posting?.amount ?? 0,
			currency: posting?.currency ?? '',
			isDevice: true,
			xact,
			id
		};
	});

	// Balance assertions: device ones from the working set, the rest from the book's directives.
	const directives = await fullLedgerService.getDirectives();
	const deviceAssertionRows: UnifiedXact[] = storedXacts
		.filter(({ xact }) => xact.balanceAssertion?.account === params.accountName)
		.map(({ xact, id }) => ({
			date: xact.date ?? '',
			payee: '',
			narration: '',
			amount: xact.balanceAssertion!.amount,
			currency: xact.balanceAssertion!.currency,
			isDevice: true,
			isAssertion: true,
			xact,
			id
		}));
	const ledgerAssertionRows: UnifiedXact[] = [];
	for (const d of directives as Array<Record<string, unknown>>) {
		if (d.type !== 'balance' || d.account !== params.accountName) continue;
		const amount = d.amount as { number?: unknown; currency?: unknown } | undefined;
		const value = parseFloat(String(amount?.number));
		if (!amount || isNaN(value)) continue;
		ledgerAssertionRows.push({
			date: String(d.date ?? ''),
			payee: '',
			narration: '',
			amount: value,
			currency: String(amount.currency ?? ''),
			isDevice: false,
			isAssertion: true
		});
	}

	// Normalize ledger rows
	const safeColumns: string[] = columns ?? [];
	const safeRows = (rows ?? []) as unknown[][];
	const idIdx = safeColumns.indexOf('id');
	const flagIdx = safeColumns.indexOf('flag');
	const dateIdx = safeColumns.indexOf('date');
	const payeeIdx = safeColumns.indexOf('payee');
	const narrationIdx = safeColumns.indexOf('narration');
	const numberIdx = safeColumns.indexOf('number');
	const currencyIdx = safeColumns.indexOf('currency');

	const ledgerNormalized: UnifiedXact[] = safeRows.map((row) => ({
		rledgerId: row[idIdx] as number,
		flag: (row[flagIdx] as string | null) ?? undefined,
		date: row[dateIdx] as string,
		payee: row[payeeIdx] as string,
		narration: row[narrationIdx] as string,
		amount: parseFloat(row[numberIdx] as string),
		currency: row[currencyIdx] as string,
		isDevice: false
	}));

	// Merge and sort descending by date
	const unifiedRows = mergeUnifiedRows(
		[...deviceRows, ...deviceAssertionRows],
		[...ledgerNormalized, ...ledgerAssertionRows]
	);

	// Flag the assertions the validator rejected. Only asked when there are assertions to check.
	if (unifiedRows.some((r) => r.isAssertion)) {
		const failures = await fullLedgerService.getAssertionFailures();
		for (const row of unifiedRows) {
			if (!row.isAssertion) continue;
			const failure = failures.find(
				(f) =>
					f.account === params.accountName &&
					f.date === row.date &&
					f.currency === row.currency &&
					f.expected === row.amount
			);
			if (failure) row.actualBalance = failure.actual;
		}
	}

	const hasDeviceXacts = deviceRows.length + deviceAssertionRows.length > 0;

	// Extract metadata from the account's open directive
	const openDirective = directives.find(
		(d) =>
			(d as { type: string }).type === 'open' &&
			(d as { account: string }).account === params.accountName
	) as { meta?: AccountMeta } | undefined;
	const accountMeta: AccountMeta = openDirective?.meta ?? {};

	const lastReconciled = lastAssertionDate(directives, params.accountName);

	return { account, totals, unifiedRows, hasDeviceXacts, accountMeta, lastReconciled };
};
