/*
    Tests for scheduled-transaction date calculation and projection.
*/
import { describe, expect, it } from 'vitest';
import { Projector, calculateNextIteration } from '$lib/scheduledTransactions';

describe('calculateNextIteration', () => {
	it.each([
		['2025-08-10', 1, 'days', '2025-08-11'],
		['2025-08-10', 2, 'weeks', '2025-08-24'],
		['2025-08-10', 1, 'months', '2025-09-10'],
		['2025-08-10', 1, 'years', '2026-08-10'],
		['2025-08-10', 10, 'days', '2025-08-20']
	])('%s + %i %s = %s', (start, count, period, expected) => {
		expect(calculateNextIteration(start, count, period, null)).toBe(expected);
	});

	it('clamps to the end of a shorter month', () => {
		expect(calculateNextIteration('2025-01-31', 1, 'months', null)).toBe('2025-02-28');
		expect(calculateNextIteration('2024-01-31', 1, 'months', null)).toBe('2024-02-29');
	});

	it('rolls across year boundaries', () => {
		expect(calculateNextIteration('2025-12-15', 1, 'months', null)).toBe('2026-01-15');
	});

	it('supports "start of month" and "end of month"', () => {
		expect(calculateNextIteration('2025-08-10', 1, 'start of month', null)).toBe('2025-09-01');
		expect(calculateNextIteration('2025-08-10', 1, 'end of month', null)).toBe('2025-09-30');
		expect(calculateNextIteration('2025-01-10', 1, 'end of month', null)).toBe('2025-02-28');
	});

	it('returns null once the end date has passed, but allows the end date itself', () => {
		expect(calculateNextIteration('2025-08-10', 1, 'months', '2025-09-09')).toBeNull();
		expect(calculateNextIteration('2025-08-10', 1, 'months', '2025-09-10')).toBe('2025-09-10');
	});

	it.each([
		[undefined, 1, 'days'],
		['2025-08-10', 0, 'days'],
		['2025-08-10', 1, undefined],
		['', 1, 'days']
	])('throws on missing input (%s, %s, %s)', (start, count, period) => {
		expect(() => calculateNextIteration(start, count as number, period, null)).toThrow(
			'missing input parameter(s)'
		);
	});
});

// TODO: Projector.projectTx only emits a schedule's own date; the recurrence loop
// (next occurrences within the range) is not implemented in src/lib/scheduledTransactions.ts.
// When it is, add cases for repeated occurrences and end dates, and revisit these tests.
describe('Projector', () => {
	const schedule = (date: string, payee: string) => ({ transaction: { date, payee } });

	it('projects schedules whose date falls within the range, inclusive', () => {
		const projector = new Projector([
			schedule('2025-08-01', 'Rent'),
			schedule('2025-08-15', 'Gym'),
			schedule('2025-09-01', 'Later')
		]);

		expect(projector.project('2025-08-01', '2025-08-31')).toEqual([
			{ date: '2025-08-01', payee: 'Rent' },
			{ date: '2025-08-15', payee: 'Gym' }
		]);
	});

	it('returns nothing when no schedule is in range or there are none', () => {
		expect(
			new Projector([schedule('2025-01-01', 'Old')]).project('2025-08-01', '2025-08-31')
		).toEqual([]);
		expect(new Projector([]).project('2025-08-01', '2025-08-31')).toEqual([]);
	});
});
