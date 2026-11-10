import { describe, expect, it } from 'vitest';
import {
	assertionDateFor,
	isReconciled,
	lastAssertionDate,
	latestAssertion,
	reconciliationDifference,
	sumTicked
} from '#lib/reconciliation/reconciliation';

describe('reconciliationDifference', () => {
	it('is statement minus book', () => {
		expect(reconciliationDifference(100, 130.5)).toBeCloseTo(30.5);
		expect(reconciliationDifference(100, 90)).toBeCloseTo(-10);
	});

	it('treats float noise below a cent as zero', () => {
		expect(reconciliationDifference(0.1 + 0.2, 0.3)).toBe(0);
		expect(isReconciled(100, 100.004)).toBe(true);
		expect(isReconciled(100, 100.01)).toBe(false);
	});
});

describe('assertionDateFor', () => {
	it('is the day after the statement date', () => {
		expect(assertionDateFor('2026-10-31')).toBe('2026-11-01');
		expect(assertionDateFor('2026-12-31')).toBe('2027-01-01');
		expect(assertionDateFor('2028-02-28')).toBe('2028-02-29');
	});
});

describe('latestAssertion', () => {
	const bal = (date: string, account: string, number: string, currency = 'EUR') => ({
		type: 'balance',
		date,
		account,
		amount: { number, currency }
	});
	const directives = [
		{ type: 'open', date: '2020-01-01', account: 'Assets:Bank' },
		bal('2026-01-01', 'Assets:Bank', '100.00'),
		bal('2026-03-01', 'Assets:Bank', '250.50'),
		bal('2026-06-01', 'Assets:Bank', '999.00'),
		bal('2026-03-05', 'Assets:Other', '1.00'),
		bal('2026-03-02', 'Assets:Bank', '5.00', 'USD')
	];

	it('picks the latest matching assertion on or before the date', () => {
		expect(latestAssertion(directives, 'Assets:Bank', 'EUR', '2026-04-30')).toEqual({
			date: '2026-03-01',
			account: 'Assets:Bank',
			amount: 250.5,
			currency: 'EUR'
		});
	});

	it('includes an assertion dated exactly on the limit', () => {
		expect(latestAssertion(directives, 'Assets:Bank', 'EUR', '2026-06-01')?.amount).toBe(999);
	});

	it('ignores other accounts and currencies', () => {
		expect(latestAssertion(directives, 'Assets:Bank', 'USD', '2026-12-31')?.amount).toBe(5);
		expect(latestAssertion(directives, 'Assets:Missing', 'EUR', '2026-12-31')).toBeUndefined();
	});

	it('returns undefined when every assertion is later', () => {
		expect(latestAssertion(directives, 'Assets:Bank', 'EUR', '2025-12-31')).toBeUndefined();
	});
});

describe('lastAssertionDate', () => {
	const bal = (date: string, account: string, currency = 'EUR') => ({
		type: 'balance',
		date,
		account,
		amount: { number: '1', currency }
	});

	it('is the latest assertion across currencies for the account', () => {
		const directives = [
			bal('2026-01-01', 'Assets:Bank'),
			bal('2026-05-01', 'Assets:Bank', 'USD'),
			bal('2026-03-01', 'Assets:Bank'),
			bal('2026-09-01', 'Assets:Other'),
			{ type: 'open', date: '2026-12-01', account: 'Assets:Bank' }
		];
		expect(lastAssertionDate(directives, 'Assets:Bank')).toBe('2026-05-01');
	});

	it('is undefined when the account has no assertion', () => {
		expect(lastAssertionDate([bal('2026-01-01', 'Assets:Other')], 'Assets:Bank')).toBeUndefined();
		expect(lastAssertionDate([], 'Assets:Bank')).toBeUndefined();
	});
});

describe('sumTicked', () => {
	it('adds only the ticked amounts', () => {
		expect(sumTicked([10, -4, 2.5], [true, false, true])).toBe(12.5);
		expect(sumTicked([10, -4], [])).toBe(0);
	});
});
