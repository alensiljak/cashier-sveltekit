/*
    Tests for the display formatting helpers (colours, amounts, dates).
    formatPostingCost/formatPostingPrice live in postingFormatter.test.ts.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	formatAmount,
	getAmountColour,
	getColourForGainLoss,
	getColourForYield,
	getDateColour,
	getMoneyColour,
	getReadableDate,
	getXactAmountColour
} from '$lib/utils/formatter';
import { Money } from '$lib/data/model';
import { makeXact } from '../helpers/factories';

const RED = 'text-red-400';
const YELLOW = 'text-yellow-200';
const GREEN = 'text-green-500';

const money = (quantity: number) => Object.assign(new Money(), { quantity, currency: 'EUR' });

describe('getAmountColour', () => {
	it.each([
		[-0.01, RED],
		[0, YELLOW],
		[0.01, GREEN]
	])('%s -> %s', (amount, colour) => {
		expect(getAmountColour(amount)).toBe(colour);
	});

	it('returns no colour for NaN', () => {
		expect(getAmountColour(NaN)).toBe('');
	});
});

describe('getMoneyColour', () => {
	it('colours by quantity and tolerates a missing value', () => {
		expect(getMoneyColour(money(-5))).toBe(RED);
		expect(getMoneyColour(undefined as unknown as Money)).toBeUndefined();
	});
});

describe('getXactAmountColour', () => {
	it('shows a transfer between two asset accounts in yellow regardless of sign', () => {
		const transfer = makeXact({ postings: ['Assets:Bank:Checking', 'Assets:Cash:Wallet'] });

		expect(getXactAmountColour(transfer, money(-50))).toBe(YELLOW);
		expect(getXactAmountColour(transfer, money(50))).toBe(YELLOW);
	});

	it('otherwise colours by the balance', () => {
		const spend = makeXact({ postings: ['Expenses:Food', 'Assets:Bank:Checking'] });

		expect(getXactAmountColour(spend, money(-50))).toBe(RED);
		expect(getXactAmountColour(spend, money(50))).toBe(GREEN);
	});

	it('does not treat asset + liability as a transfer', () => {
		const card = makeXact({ postings: ['Assets:Bank:Checking', 'Liabilities:CreditCard'] });

		expect(getXactAmountColour(card, money(-50))).toBe(RED);
	});
});

describe('getColourForYield', () => {
	it('strips the trailing % and colours by sign', () => {
		expect(getColourForYield('5.2%')).toBe(GREEN);
		expect(getColourForYield('-3%')).toBe(RED);
		expect(getColourForYield('0%')).toBe(YELLOW);
	});

	it('returns no colour for an empty value', () => {
		expect(getColourForYield('')).toBe('');
	});
});

describe('getColourForGainLoss', () => {
	it('colours by the leading number', () => {
		expect(getColourForGainLoss('12.5 EUR')).toBe(GREEN);
		expect(getColourForGainLoss('-12.5 EUR')).toBe(RED);
		expect(getColourForGainLoss('0 EUR')).toBe(YELLOW);
	});

	it('returns no colour for an empty value', () => {
		expect(getColourForGainLoss('')).toBe('');
	});
});

describe('formatAmount', () => {
	it.each([
		[0, '0'],
		[1234, '1,234'],
		[-1234, '-1,234'],
		[1234.5, '1,234.50'],
		[-5.5, '-5.50'],
		[0.5, '0.50'],
		[12.345, '12.345']
	])('%s -> %s', (amount, expected) => {
		expect(formatAmount(amount)).toBe(expected);
	});

	it('returns an empty string for null/undefined', () => {
		expect(formatAmount(null as unknown as number)).toBe('');
		expect(formatAmount(undefined as unknown as number)).toBe('');
	});

	// TODO: whole numbers drop their decimals ("1,234") while fractional ones show 2-3
	// ("1,234.50", "12.345"), so a column of amounts has inconsistent precision. Decide the
	// intended rule (fixed 2? currency-aware?) and pin it here.
});

describe('getReadableDate', () => {
	it('shortens an ISO date, with an optional format', () => {
		expect(getReadableDate('2025-12-07')).toBe('Dec 07');
		expect(getReadableDate('2025-12-07', 'DD.MM.YYYY')).toBe('07.12.2025');
	});
});

describe('getDateColour', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2025, 7, 15, 13, 30)); // 2025-08-15 local
	});
	afterEach(() => vi.useRealTimers());

	it('marks past dates and future dates differently', () => {
		expect(getDateColour('2025-08-14')).toBe('text-secondary-400');
		expect(getDateColour('2025-08-16')).toBe('text-primary-400');
	});

	it("returns 'text-neutral' for today, whatever the time of day", () => {
		expect(getDateColour('2025-08-15')).toBe('text-neutral');
	});
});
