/*
    Account Transactions
*/

import { Account, Money, Xact } from '$lib/data/model.js';
import ledgerService from '$lib/services/ledgerService.js';

export async function load({ params }) {
	if (!params.accountName) {
		throw new Error('Account must be specified!');
	}

	const accounts = ledgerService.getAllAccounts();
	const account = accounts.find((a) => a.name === params.accountName);
	if (!account) {
		throw new Error('Account not found!');
	}

	const xacts = ledgerService
		.getXacts()
		.filter((xact) => xact.postings?.some((p) => p.account === params.accountName));

	const total = calculateCurrentBalance(xacts, account);

	return { account, xacts, total };
}

function calculateCurrentBalance(xacts: Xact[], account: Account) {
	const balance = new Money();

	for (const xact of xacts) {
		for (const posting of xact.postings.filter((p) => p.account === account.name)) {
			if (posting.amount) {
				balance.quantity += posting.amount;
				balance.currency ??= posting.currency;
			}
		}
	}

	return balance;
}
