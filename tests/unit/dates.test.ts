import { describe, expect, it } from 'vitest';
import {
	add,
	addMonths,
	diffDays,
	diffMonths,
	diffYears,
	endOfMonth,
	endOfYear,
	formatDate,
	isSameUnit,
	parseDate,
	startOfMonth,
	startOfYear
} from '#lib/utils/dates';

const iso = (d: Date) => formatDate(d);

describe('parseDate', () => {
	it('parses ISO dates as local midnight', () => {
		const d = parseDate('2025-12-07');
		expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2025, 11, 7, 0]);
	});

	it('parses a month as its first day', () => {
		expect(iso(parseDate('2025-03'))).toBe('2025-03-01');
	});

	it('gives an Invalid Date for garbage', () => {
		expect(Number.isNaN(parseDate('nope').getTime())).toBe(true);
	});
});

describe('add', () => {
	it.each([
		['2025-08-10', 1, 'day', '2025-08-11'],
		['2025-08-10', 2, 'week', '2025-08-24'],
		['2025-08-10', 1, 'month', '2025-09-10'],
		['2025-08-10', 1, 'year', '2026-08-10'],
		['2025-03-01', -1, 'day', '2025-02-28'],
		['2025-01-15', -2, 'month', '2024-11-15']
	] as const)('%s + %i %s = %s', (start, n, unit, expected) => {
		expect(iso(add(parseDate(start), n, unit))).toBe(expected);
	});

	it('clamps month and year arithmetic to the end of a shorter month', () => {
		expect(iso(addMonths(parseDate('2025-01-31'), 1))).toBe('2025-02-28');
		expect(iso(addMonths(parseDate('2024-01-31'), 1))).toBe('2024-02-29');
		expect(iso(add(parseDate('2024-02-29'), 1, 'year'))).toBe('2025-02-28');
		expect(iso(addMonths(parseDate('2025-03-31'), -1))).toBe('2025-02-28');
	});

	it('does not mutate its input', () => {
		const d = parseDate('2025-01-31');
		addMonths(d, 1);
		expect(iso(d)).toBe('2025-01-31');
	});
});

describe('start/end of period', () => {
	it('finds month and year boundaries', () => {
		const d = parseDate('2024-02-10');
		expect(iso(startOfMonth(d))).toBe('2024-02-01');
		expect(iso(endOfMonth(d))).toBe('2024-02-29');
		expect(iso(startOfYear(d))).toBe('2024-01-01');
		expect(iso(endOfYear(d))).toBe('2024-12-31');
	});
});

describe('isSameUnit', () => {
	it('compares months and years', () => {
		expect(isSameUnit(parseDate('2025-08-01'), parseDate('2025-08-31'), 'month')).toBe(true);
		expect(isSameUnit(parseDate('2025-08-01'), parseDate('2024-08-01'), 'month')).toBe(false);
		expect(isSameUnit(parseDate('2025-01-01'), parseDate('2025-12-31'), 'year')).toBe(true);
	});
});

describe('diffs', () => {
	it('counts whole days, ignoring time of day and DST', () => {
		expect(diffDays(parseDate('2025-03-31'), parseDate('2025-03-29'))).toBe(2);
		expect(diffDays(parseDate('2025-10-27'), parseDate('2025-10-25'))).toBe(2);
		expect(diffDays(parseDate('2025-08-01'), parseDate('2025-08-03'))).toBe(-2);
	});

	it('counts whole months and years, truncating toward zero', () => {
		expect(diffMonths(parseDate('2025-08-15'), parseDate('2025-06-15'))).toBe(2);
		expect(diffMonths(parseDate('2025-08-14'), parseDate('2025-06-15'))).toBe(1);
		expect(diffMonths(parseDate('2025-06-15'), parseDate('2025-08-14'))).toBe(-1);
		expect(diffYears(parseDate('2025-08-15'), parseDate('2023-08-16'))).toBe(1);
	});
});

describe('formatDate', () => {
	const d = new Date(2026, 7, 5, 9, 4, 3);

	it.each([
		['YYYY-MM-DD', '2026-08-05'],
		['D MMM YYYY', '5 Aug 2026'],
		['MMM D, YYYY', 'Aug 5, 2026'],
		['DD/MM/YYYY', '05/08/2026'],
		['MM/DD/YYYY', '08/05/2026'],
		['MMM DD', 'Aug 05'],
		['D.M.', '5.8.'],
		['DD.MM.', '05.08.'],
		['MMMM YYYY', 'August 2026'],
		['MMM YY', 'Aug 26'],
		['HHmmss', '090403'],
		['HH:mm', '09:04'],
		['[on] D', 'on 5']
	])('%s -> %s', (format, expected) => {
		expect(formatDate(d, format)).toBe(expected);
	});

	it('defaults to ISO', () => {
		expect(formatDate(d)).toBe('2026-08-05');
	});

	it('uses the English short month name', () => {
		expect(formatDate(new Date(2026, 8, 1), 'MMM')).toBe('Sep');
	});
});
