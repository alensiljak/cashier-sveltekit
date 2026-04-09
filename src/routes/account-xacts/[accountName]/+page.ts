/*
    Account Transactions
*/

import { Money } from '$lib/data/model.js';
import ledgerService from '$lib/services/ledgerService.js';
import fullLedgerService from '$lib/services/ledgerWorkerClient';


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

	await ledgerService.load();
	const xacts = ledgerService
		.getXacts()
		.filter((xact) => xact.postings?.some((p) => p.account === params.accountName));

	return { account, xacts, total };
}
