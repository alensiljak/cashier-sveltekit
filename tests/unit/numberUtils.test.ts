/*
    Tests for addDecimalStrings, which sums decimal strings without
    floating-point drift.
*/
import { describe, expect, it } from 'vitest';
import { addDecimalStrings } from '$lib/utils/numberUtils';

describe('addDecimalStrings', () => {
	it('avoids the classic floating-point error', () => {
		expect(0.1 + 0.2).not.toBe(0.3);
		expect(addDecimalStrings(['0.1', '0.2'])).toBe(0.3);
	});

	it('aligns numbers with different decimal places', () => {
		expect(addDecimalStrings(['1', '2.5', '0.125'])).toBe(3.625);
	});

	it('handles negatives', () => {
		expect(addDecimalStrings(['10.10', '-0.30'])).toBe(9.8);
	});

	it('returns 0 for an empty list and passes a single value through', () => {
		expect(addDecimalStrings([])).toBe(0);
		expect(addDecimalStrings(['42.42'])).toBe(42.42);
	});
});
