/*
    Account Transactions

    Uses the account's current balance in Ledger as initial balance and
    applies local transactions to it.
*/

import db from '$lib/data/db.js';
import { Account, Money, Posting, Xact } from '$lib/data/model.js';
import * as AccountService from '$lib/services/accountsService.js';
import { XactAugmenter } from '$lib/utils/xactAugmenter.js';

export async function load({ params }) {
	if (!params.accountName) {
		throw new Error('Account must be specified!');
	}

	const xacts: Xact[] = [];
	const account = await loadAccount(params.accountName);

	// get the initial balance
	const initialXact = createInitialBalanceXact(account);
	xacts.push(initialXact);

	// get all the transactions that have a posting for this account.
	const accountXacts = await loadTransactions(params.accountName);
	xacts.push(...accountXacts);

	// sum the amount for the account.
	const total = calculateCurrentBalance(xacts, account);

	return { account, xacts, total };
}

function calculateCurrentBalance(xacts: Xact[], account: Account) {
	const balance = new Money();
	balance.currency = account.balance?.currency as string;

	for (const xact of xacts) {
		const postings = xact.postings.filter((p) => p.account === account.name);
		if (!postings) continue;

		for (const posting of postings) {
			if (posting.currency === balance.currency && posting.amount) {
				balance.quantity += posting.amount;
			}
		}
	}

	return balance;
}

function createInitialBalanceXact(account: Account): Xact {
	// create the initial transaction

	const xact = new Xact();
	xact.date = '1900-01-01';
	xact.payee = 'Initial Balance';

	const posting = new Posting();
	posting.account = account.name;
	posting.amount = account.balance?.quantity;
	posting.currency = account.balance?.currency as string;
	xact.postings = [posting];

	return xact;
}

async function loadAccount(accountName: string) {
	// get the account balance
	const account = await db.accounts.get(accountName);
	if (!account) {
		throw new Error('Account not found!');
	}

	await AccountService.populateAccountBalances([account]);

	return account;
}

async function loadTransactions(accountName: string): Promise<Xact[]> {
	const list: Xact[] = await db.xacts.orderBy('date').toArray();

	// add the missing amounts on Postings.
	XactAugmenter.calculateEmptyPostingAmounts(list);

	const accountXacts = list.filter(
		(xact) => xact.postings && xact.postings.some((p) => p.account === accountName)
	);

	return accountXacts;
}
