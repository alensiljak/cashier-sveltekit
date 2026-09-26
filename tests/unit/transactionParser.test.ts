/*
    Tests for transactionParser: posting extraction, directive metadata/default
    handling, and parseXact against the real ledger parser. (Price/cost mapping
    of directiveToXact is covered in xactParser.test.ts.)
*/
import { beforeAll, describe, expect, it } from 'vitest';
import { TransactionParser, directiveToXact, parseXact } from '$lib/utils/transactionParser';
import { ensureInitialized } from '$lib/services/rustledger';
import { makeXact } from '../helpers/factories';

beforeAll(async () => {
	await ensureInitialized();
});

describe('TransactionParser.extractPostingsFor', () => {
	it('collects the postings for one account across transactions', () => {
		const txs = [
			makeXact({ postings: [{ account: 'Expenses:Food', amount: 5 }, 'Assets:Cash'] }),
			makeXact({ postings: [{ account: 'Expenses:Food', amount: 7 }, 'Assets:Bank'] }),
			makeXact({ postings: ['Expenses:Rent'] })
		];

		const postings = TransactionParser.extractPostingsFor(txs, 'Expenses:Food');

		expect(postings.map((p) => p.amount)).toEqual([5, 7]);
	});

	it('matches whole account names only', () => {
		const txs = [makeXact({ postings: ['Expenses:Food:Dining'] })];

		expect(TransactionParser.extractPostingsFor(txs, 'Expenses:Food')).toEqual([]);
	});
});

describe('directiveToXact defaults and metadata', () => {
	it('fills defaults for a sparse directive', () => {
		const xact = directiveToXact({ date: '2025-08-10', postings: [{ account: 'Assets:Cash' }] });

		expect(xact).toMatchObject({ date: '2025-08-10', payee: '', note: '', flag: '*', meta: {} });
		expect(xact.postings[0]).toMatchObject({ account: 'Assets:Cash', currency: '' });
		expect(xact.postings[0].amount).toBeUndefined();
	});

	it('keeps an explicit flag and narration', () => {
		const xact = directiveToXact({
			date: '2025-08-10',
			flag: '!',
			narration: 'Pending',
			payee: 'P'
		});

		expect(xact).toMatchObject({ flag: '!', note: 'Pending', payee: 'P' });
	});

	it('coerces non-string metadata values to strings', () => {
		const xact = directiveToXact({
			date: '2025-08-10',
			meta: {
				isin: 'IE00B3RBWM25',
				flag: true,
				count: 3,
				amt: { number: '1', currency: 'EUR' },
				none: null
			}
		});

		expect(xact.meta).toEqual({
			isin: 'IE00B3RBWM25',
			flag: 'true',
			count: '3',
			amt: '{"number":"1","currency":"EUR"}',
			none: ''
		});
	});
});

describe('parseXact', () => {
	it('parses Beancount text into an Xact', () => {
		const xact = parseXact(`2025-08-10 * "Supermarket" "Groceries"
  Expenses:Groceries   45.50 EUR
  Assets:Bank:Checking
`);

		expect(xact).toMatchObject({ date: '2025-08-10', payee: 'Supermarket', note: 'Groceries' });
		expect(xact.postings.map((p) => [p.account, p.amount, p.currency])).toEqual([
			['Expenses:Groceries', 45.5, 'EUR'],
			['Assets:Bank:Checking', undefined, '']
		]);
	});

	it('keeps the @@ total price the user typed', () => {
		const xact = parseXact(`2025-08-10 * "Broker" "Buy"
  Assets:Investments:VTI   10 VTI @@ 2000 EUR
  Assets:Bank:Checking
`);

		expect(xact.postings[0]).toMatchObject({
			priceAmount: 2000,
			priceCurrency: 'EUR',
			totalPrice: true
		});
	});

	it('rejects empty input', () => {
		expect(() => parseXact('')).toThrow('Missing input');
	});

	it('rejects input with no transaction', () => {
		expect(() => parseXact('2025-01-01 open Assets:Cash')).toThrow('No transaction found');
	});
});
