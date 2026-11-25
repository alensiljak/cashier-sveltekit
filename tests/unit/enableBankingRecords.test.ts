// @vitest-environment node
/*
    Tests for the pure readings of Enable Banking records (records.ts) and the
    bounded parallel loop (concurrency.ts).
*/
import { describe, expect, it } from 'vitest';
import { forEachLimited } from '#lib/importers/enablebanking/concurrency';
import {
	accountIdentity,
	displayBalance,
	isBooked,
	transactionDedupKey,
	txAmount,
	txPayee
} from '#lib/importers/enablebanking/records';

describe('displayBalance', () => {
	it('follows the preference order, not the order of the response', () => {
		const balances = [{ balance_type: 'XPCD' }, { balance_type: 'ITAV' }, { balance_type: 'CLBD' }];
		expect(displayBalance(balances)?.balance_type).toBe('CLBD');
		expect(displayBalance(balances.slice(0, 2))?.balance_type).toBe('ITAV');
	});

	it('falls back to the first balance, or null', () => {
		expect(displayBalance([{ balance_type: 'OTHR' }, { balance_type: 'INFO' }])).toEqual({
			balance_type: 'OTHR'
		});
		expect(displayBalance([])).toBeNull();
		expect(displayBalance(undefined)).toBeNull();
	});
});

describe('transactions', () => {
	const parties = { creditor: { name: 'Creditor' }, debtor: { name: 'Debtor' } };

	it('names the other party according to the direction', () => {
		expect(txPayee({ ...parties, credit_debit_indicator: 'CRDT' })).toBe('Debtor');
		expect(txPayee({ ...parties, credit_debit_indicator: 'DBIT' })).toBe('Creditor');
		// Never the account owner in place of a missing counterparty.
		expect(txPayee({ creditor: { name: 'Me' }, credit_debit_indicator: 'CRDT' })).toBe('');
	});

	it('signs the amount by the direction', () => {
		const transaction_amount = { amount: '12.50', currency: 'EUR' };
		expect(txAmount({ transaction_amount, credit_debit_indicator: 'DBIT' })).toBe(-12.5);
		expect(txAmount({ transaction_amount, credit_debit_indicator: 'CRDT' })).toBe(12.5);
		expect(txAmount({})).toBeNull();
	});

	it('treats only BOOK as booked', () => {
		expect(isBooked({ status: 'BOOK' })).toBe(true);
		expect(isBooked({ status: 'PDNG' })).toBe(false);
	});

	it('keys deduplication on the account and entry_reference, ignoring transaction_id', () => {
		const tx = { entry_reference: 'r1', transaction_id: 't1' };
		expect(transactionDedupKey('h1', tx)).toBe(
			transactionDedupKey('h1', { ...tx, transaction_id: 't2' })
		);
		expect(transactionDedupKey('h1', tx)).not.toBe(transactionDedupKey('h2', tx));
	});

	it('falls back to the content without an entry_reference', () => {
		const tx = { booking_date: '2026-11-01', transaction_amount: { amount: '5.00' } };
		expect(transactionDedupKey('h1', { ...tx, transaction_id: 't1' })).toBe(
			transactionDedupKey('h1', tx)
		);
		expect(transactionDedupKey('h1', tx)).not.toBe(
			transactionDedupKey('h1', { ...tx, booking_date: '2026-11-02' })
		);
	});
});

describe('accountIdentity', () => {
	it('prefers the identification hash over the session uid', () => {
		expect(accountIdentity({ uid: 'u1', identification_hash: 'h1' })).toBe('h1');
		expect(accountIdentity({ uid: 'u1' })).toBe('u1');
	});
});

describe('forEachLimited', () => {
	it('runs every item with at most `limit` in flight', async () => {
		let running = 0;
		let peak = 0;
		const done: number[] = [];
		await forEachLimited([1, 2, 3, 4, 5], 2, async (n) => {
			peak = Math.max(peak, ++running);
			await new Promise((resolve) => setTimeout(resolve, 1));
			running--;
			done.push(n);
		});
		expect(peak).toBe(2);
		expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
	});
});
